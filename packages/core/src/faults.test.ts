import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { faultBlock, selectFaults } from './faults';

const marked = [
  "This run's fault: **`${Q1_FAULT}`**.",
  faultBlock('Q1_FAULT', 'quota', '#### Quota exhausted (`quota`)\n\nRaise the quota.'),
  faultBlock('Q1_FAULT', 'node-selector', '#### nodeSelector matching no node (`node-selector`)\n\nFix the selector.'),
  '### Question 2: Next',
].join('\n\n');

const legacy = `### Question 1: Unhealthy Deployment

This run's fault: **\`\${Q1_FAULT}\`**.

Every fault this question can roll:

#### Quota exhausted (\`quota\`)

Raise the quota.

\`\`\`bash
### not a heading
kubectl edit quota
\`\`\`

#### nodeSelector matching no node (\`node-selector\`)

Fix the selector.

### Question 2: Next

#### Kept (\`quota\`)
`;

describe('selectFaults', () => {
  it('keeps only the rolled fault of a marked solution, without the markers', () => {
    const out = selectFaults(marked, { Q1_FAULT: 'node-selector' });
    assert.match(out, /Fix the selector/);
    assert.doesNotMatch(out, /quota|<!--/);
    assert.match(out, /### Question 2: Next/);
  });

  it('keeps every fault when the variable has no value', () => {
    const out = selectFaults(marked, {});
    assert.match(out, /Raise the quota/);
    assert.match(out, /Fix the selector/);
  });

  it('filters the older layout by its section headings', () => {
    const out = selectFaults(legacy, { Q1_FAULT: 'node-selector' });
    assert.match(out, /Fix the selector/);
    assert.doesNotMatch(out, /Raise the quota|kubectl edit quota|not a heading|Every fault/);
    assert.match(out, /### Question 2: Next\n\n#### Kept/);
  });

  it('leaves the older layout alone when the variable has no value', () => {
    assert.equal(selectFaults(legacy, {}), legacy);
  });
});
