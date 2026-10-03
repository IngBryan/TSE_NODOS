import { connect, type ChannelModel, type ConfirmChannel } from "amqplib";

// The topology is owned by RabbitMQ (rabbitmq/definitions.json at the repo root);
// this service only publishes. These names must match that file.
export const TRACKING_EXCHANGE = "tracking";
export const TRACKING_EVENT_ROUTING_KEY = "tracking.event";

interface RabbitConfig {
  hostname: string;
  port: number;
  username: string;
  password: string;
}

export function getRabbitConfig(): RabbitConfig {
  const { RABBITMQ_HOST, RABBITMQ_PORT, RABBITMQ_USER, RABBITMQ_PASSWORD } = process.env;
  const missing = Object.entries({ RABBITMQ_HOST, RABBITMQ_USER, RABBITMQ_PASSWORD })
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return {
    hostname: RABBITMQ_HOST!,
    port: Number(RABBITMQ_PORT) || 5672,
    username: RABBITMQ_USER!,
    password: RABBITMQ_PASSWORD!,
  };
}

interface Connection {
  model: ChannelModel;
  channel: ConfirmChannel;
}

// One lazily opened connection per process, kept on globalThis to survive hot
// reloads in `next dev`. Dropped on close so the next publish reconnects.
const g = globalThis as unknown as { __trackingRabbit?: Promise<Connection> };

async function open(onClose: () => void): Promise<Connection> {
  const model = await connect({ protocol: "amqp", ...getRabbitConfig(), vhost: "/" }, { timeout: 5000 });
  model.on("error", (err) => console.error("[rabbitmq] connection error:", err.message));
  model.on("close", onClose);
  try {
    const channel = await model.createConfirmChannel();
    channel.on("error", (err) => console.error("[rabbitmq] channel error:", err.message));
    channel.on("close", () => {
      onClose();
      model.close().catch(() => {});
    });
    // Published with `mandatory`: messages that match no binding come back here.
    channel.on("return", (msg) =>
      console.warn(`[rabbitmq] unroutable message (routing key ${msg.fields.routingKey})`),
    );
    return { model, channel };
  } catch (err) {
    await model.close().catch(() => {});
    throw err;
  }
}

function getConnection(): Promise<Connection> {
  if (!g.__trackingRabbit) {
    const current: Promise<Connection> = open(() => {
      if (g.__trackingRabbit === current) g.__trackingRabbit = undefined;
    }).catch((err) => {
      if (g.__trackingRabbit === current) g.__trackingRabbit = undefined;
      throw err;
    });
    g.__trackingRabbit = current;
  }
  return g.__trackingRabbit;
}

/** Publishes a persistent JSON message and waits for the broker to confirm it. */
export async function publishJson(
  exchange: string,
  routingKey: string,
  payload: unknown,
  messageId: string,
): Promise<void> {
  const { channel } = await getConnection();
  channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    mandatory: true,
    contentType: "application/json",
    messageId,
    type: routingKey,
    timestamp: Math.floor(Date.now() / 1000),
  });
  await channel.waitForConfirms();
}
