// -----------------------------------------------------------------------------
// tests/test.js  � Orchestrator: imports all test modules, then prints summary
//
// Run with:  node tests/test.js            (from project root)
// Or from:   node test.js                  (from inside tests/)
// -----------------------------------------------------------------------------

import './test-lexer.js';
import './test-parser.js';
import './test-typechecker.js';
import './test-codegen.js';
import './test-macros.js';
import './test-parser-recovery.js';
import './test-defer.js';
import './test-ast-renderer.js';
import './test-struct.js';
import './test-ide-logic.js';
import './test-ide-ui.js';
import './test-namespace.js';
import './test-ide-smoke.js';
import { summarize } from './helpers.js';

summarize();
