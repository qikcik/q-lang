// ide/ide-state.js — Shared passive state store.
//
// Single source of truth for all post-compile mutable IDE state.
// State is set from main.js after each compile; consumed by any module
// that needs it.  No imports — zero dependency to avoid cycles.

let _expLog          = null;
let _lastAst         = null;
let _lastTokens      = null;
let _lastHoverData   = [];
let _lastLineIndex   = null;
let _lastErrorRange  = null;
let _lastErrorRanges = [];
let _lastErrorInfo   = null;
let _lastImportEnv   = new Map();

export function setExpLog(log)         { _expLog          = log ?? null; }
export function getExpLog()            { return _expLog; }

export function setLastAst(ast)        { _lastAst         = ast;   }
export function getLastAst()           { return _lastAst;          }
export function setLastTokens(toks)    { _lastTokens      = toks;  }
export function getLastTokens()        { return _lastTokens;       }
export function setLastHoverData(data) { _lastHoverData   = data;  }
export function getLastHoverData()     { return _lastHoverData;    }
export function setLastLineIndex(idx)  { _lastLineIndex   = idx;   }
export function getLastLineIndex()     { return _lastLineIndex;    }
export function setLastErrorRange(r)   { _lastErrorRange  = r;     }
export function getLastErrorRange()    { return _lastErrorRange;   }
export function setLastErrorRanges(rs) { _lastErrorRanges = rs ?? []; _lastErrorRange = rs?.[0] ?? null; }
export function getLastErrorRanges()   { return _lastErrorRanges;  }
export function setLastErrorInfo(info) { _lastErrorInfo   = info;  }
export function getLastErrorInfo()     { return _lastErrorInfo;    }
export function setLastImportEnv(env)  { _lastImportEnv  = env ?? new Map(); }
export function getLastImportEnv()     { return _lastImportEnv;    }
