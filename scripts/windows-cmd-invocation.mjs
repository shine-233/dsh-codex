import { extname } from 'node:path';

function quoteCmdArgument(value) {
  // cmd.exe expands percent variables even inside quotes, and embedded quotes
  // cannot be represented without changing argv. Build arguments never need
  // either form, so reject them instead of silently invoking a different path.
  if (/[\0\r\n"%!]/u.test(value)) {
    throw new Error('unsupported character in Windows command argument');
  }
  return `"${value}"`;
}

function validateScriptPath(script) {
  if (/[\0\r\n"%&|<>^!]/u.test(script)) {
    throw new Error('unsupported character in Windows command shim path');
  }
}

export function windowsCmdInvocation(script, args, comspec = process.env.ComSpec || 'cmd.exe') {
  const extension = extname(script).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat') {
    throw new Error(`unsupported Windows command shim: ${extension || '<none>'}`);
  }
  validateScriptPath(script);
  const command = [script, ...args].map(quoteCmdArgument).join(' ');
  // With cmd.exe /s /c the command itself must be wrapped in one additional
  // quote pair. Quoting every argv element without this outer pair causes cmd
  // to strip the executable's opening quote and misparse paths with spaces.
  return { executable: comspec, args: ['/d', '/s', '/c', `"${command}"`] };
}
