let context = {};

export function setLoggerContext(meta = {}) {
  context = { ...meta };
}

function write(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...context,
    ...meta
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info(message, meta = {}) {
    write("info", message, meta);
  },
  error(message, meta = {}) {
    write("error", message, meta);
  }
};
