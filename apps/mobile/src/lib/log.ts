import { scrubText } from '@loopfield/core';

/** The only logging entry point in the app: output is scrubbed of tokens, emails and coordinates. */
export const log = {
  info: (msg: string) => {
    if (__DEV__) console.warn(`[info] ${scrubText(msg)}`);
  },
  warn: (msg: string) => console.warn(scrubText(msg)),
  error: (msg: string, err?: unknown) => console.error(scrubText(msg), err instanceof Error ? scrubText(err.message) : '')
};
