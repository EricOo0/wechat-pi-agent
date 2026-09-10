import { Script, createContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { TRACE_PAGE_HTML } from '../../src/entrypoints/admin-http/trace-page.js';
class Node {
  textContent = '';
  className = '';
  children: Node[] = [];
  append(...nodes: Node[]): void { this.children.push(...nodes); }
  get text(): string { return [this.textContent,...this.children.map(child=>child.text)].join('\n'); }
}
function render(item: unknown): string {
  const script = /<script>([\s\S]*)<\/script>/.exec(TRACE_PAGE_HTML)![1]!;
  const scope = createContext({ document: { createElement: () => new Node() }, item });
  new Script(script.slice(0,script.indexOf('async function get('))).runInContext(scope);
  const node = new Script('reasoningView(item)').runInContext(scope) as Node;
  return node.text;
}
describe('readable reasoning in Trace input',()=>{
  it('shows returned summaries and readable content while hiding encrypted data',()=>{
    const text=render({type:'reasoning',summary:[{type:'summary_text',text:'I will inspect the file.'}],content:[{type:'reasoning_text',text:'Returned explanatory text.'}],encrypted_content:'OPAQUE_SECRET'});
    expect(text).toContain('I will inspect the file.');expect(text).toContain('Returned explanatory text.');expect(text).toContain('另有加密推理状态');expect(text).not.toContain('OPAQUE_SECRET');expect(text).not.toContain('无可读摘要');
  });
  it('shows a summary even when there is no encrypted state',()=>{
    const text=render({type:'reasoning',summary:[{text:'Visible summary'}]});expect(text).toContain('Visible summary');expect(text).not.toContain('加密');
  });
  it('distinguishes opaque-only and empty reasoning',()=>{
    expect(render({type:'reasoning',summary:[],encrypted_content:'secret'})).toContain('推理状态已回传，无可读摘要');
    expect(render({type:'reasoning',summary:[]})).toContain('接口未返回可读推理文本');
  });
  it('keeps explicit truncation notices for readable fields',()=>{
    expect(render({type:'reasoning',summary:[{text:{truncated:true,preview:'partial summary',originalCharacters:2000000}}]})).toContain('partial summary');
  });
});
