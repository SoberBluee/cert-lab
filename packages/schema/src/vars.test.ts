import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { render, renderDeep, rollVariable, rollVars, varRefs } from './vars';

/** Returns the given values in turn, then repeats the last one. */
const seq =
  (...xs: number[]) =>
  () =>
    xs.length > 1 ? xs.shift()! : xs[0];

describe('varRefs', () => {
  it('finds each ${UPPER} name once', () => {
    assert.deepEqual(varRefs('kubectl -n ${NS} get ${KIND} ${NAME} -n ${NS}'), ['NS', 'KIND', 'NAME']);
  });

  it('ignores lowercase, bare $NAME and command substitution', () => {
    assert.deepEqual(varRefs('${lower} $NS $(date) ${HOME_dir}'), []);
  });
});

describe('render', () => {
  it('replaces only declared names', () => {
    assert.equal(render('ns ${NS} home ${HOME} pod $POD', { NS: 'shop' }), 'ns shop home ${HOME} pod $POD');
  });

  it('leaves shell syntax untouched', () => {
    const text = `ip=$(kubectl get node -o jsonpath='{.items[0].status.addresses[0].address}'); echo "\${NS}-$ip"`;
    assert.equal(render(text, { NS: 'a' }), text.replace('${NS}', 'a'));
  });

  it('renders every string of nested values', () => {
    const check = { id: 'c', run: 'kubectl -n ${NS} get pod', expect: { equals: '${N}' }, args: ['${NS}'], weight: 2 };
    assert.deepEqual(renderDeep(check, { NS: 'x', N: '3' }), {
      id: 'c',
      run: 'kubectl -n x get pod',
      expect: { equals: '3' },
      args: ['x'],
      weight: 2,
    });
  });
});

describe('rollVariable', () => {
  it('picks from oneOf and stringifies numbers', () => {
    assert.equal(rollVariable({ oneOf: ['a', 'b', 'c'] }, 2, () => 0.5), 'b');
    assert.equal(rollVariable({ oneOf: [80, 8080] }, 2, () => 0.99), '8080');
  });

  it('covers both ends of a range', () => {
    assert.equal(rollVariable({ range: [3, 5] }, 2, () => 0), '3');
    assert.equal(rollVariable({ range: [3, 5] }, 2, () => 0.9999), '5');
  });

  it('picks worker or any node within the topology', () => {
    assert.equal(rollVariable({ node: 'workers' }, 2, () => 0.99), 'worker-2');
    assert.equal(rollVariable({ node: 'workers' }, 1, () => 0.99), 'worker-1');
    assert.equal(rollVariable({ node: 'any' }, 2, () => 0), 'controlplane');
  });

  it('makes random names that start with a letter', () => {
    const name = rollVariable({ random: 8 }, 2, seq(0.99, 0.99, 0.5));
    assert.equal(name.length, 8);
    assert.match(name, /^[a-z][a-z0-9]{7}$/);
    for (let i = 0; i < 200; i++) assert.match(rollVariable({ random: 5 }, 2), /^[a-z][a-z0-9]{4}$/);
  });
});

describe('rollVars', () => {
  it('rolls every variable and honours pinned values', () => {
    const vars = rollVars({ NS: { oneOf: ['a', 'b'] }, PORT: { range: [1, 1] }, NODE: { node: 'workers' } }, 2, { NS: 'pinned' });
    assert.deepEqual(Object.keys(vars), ['NS', 'PORT', 'NODE']);
    assert.equal(vars.NS, 'pinned');
    assert.equal(vars.PORT, '1');
    assert.match(vars.NODE, /^worker-[12]$/);
  });
});
