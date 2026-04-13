import { compile } from '../compiler/pipeline.js';

const { ast } = compile('S := struct { name: array<u8, 32>; };');
const st = ast.body[0]._type;
console.log('byteSize:', st.byteSize);
console.log('fields[0].type:', JSON.stringify(st.fields[0].type));
