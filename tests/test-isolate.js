import { tokenize } from '../compiler/lexer.js';
import { parse } from '../compiler/parser.js';
import { typecheck } from '../compiler/staticTypeChecker.js';
import { generate } from '../compiler/codegen.js';

const src = `main := fn() i32 {
    x := 55;
    y := 720;
    sc := (x > 50) && (y > 100);
    if (sc) { return 1; }
    return 0;
};`;

try {
  const tokens = tokenize(src);
  const ast = parse(tokens);
  typecheck(ast);
  const { bytes } = generate(ast);
  console.log('Compile OK, bytes:', bytes.length);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      write_utf8: () => 0, print_utf8: (ptr, len) => { return 0; },
      input_utf8: () => 0,
    }
  });
  const result = instance.exports.main();
  console.log('main() =', result);
  if (result !== 1) {
    console.error('FAIL: expected 1, got', result);
    process.exit(1);
  }
  console.log('PASS');
} catch(e) {
  console.error('ERROR:', e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
}
