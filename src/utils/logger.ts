import { debug } from "debug";
import { MODULE_NAME } from "./constants.js";

export class Logger {
  private readonly _trace: debug.Debugger;
  private readonly _debug: debug.Debugger;
  private readonly _info: debug.Debugger;
  private readonly _warn: debug.Debugger;
  private readonly _error: debug.Debugger;

  constructor(prefix?: string) {
    const base = prefix ? `${MODULE_NAME}:${prefix}` : MODULE_NAME;

    this._trace = debug(`${base}:TRACE`);
    this._debug = debug(`${base}:DEBUG`);
    this._info = debug(`${base}:INFO`);
    this._warn = debug(`${base}:WARN`);
    this._error = debug(`${base}:ERROR`);

    /* eslint-disable no-console */
    this._trace.log = console.trace.bind(console);
    this._debug.log = console.debug.bind(console);
    this._info.log = console.info.bind(console);
    this._warn.log = console.warn.bind(console);
    this._error.log = console.error.bind(console);
    /* eslint-enable no-console */
  }

  get trace(): debug.Debugger {
    return this._trace;
  }

  get debug(): debug.Debugger {
    return this._debug;
  }

  get info(): debug.Debugger {
    return this._info;
  }

  get warn(): debug.Debugger {
    return this._warn;
  }

  get error(): debug.Debugger {
    return this._error;
  }
}
