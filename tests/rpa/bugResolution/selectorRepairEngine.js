const ATTRIBUTE_PRIORITIES = Object.freeze([
  { key: 'data-testid', weight: 1.0 },
  { key: 'data-id', weight: 0.92 },
  { key: 'aria-label', weight: 0.87 },
  { key: 'role', weight: 0.8 },
  { key: 'name', weight: 0.73 },
  { key: 'id', weight: 0.66 },
  { key: 'text', weight: 0.58 },
  { key: 'class', weight: 0.35 },
]);

function quote(value) {
  return String(value).replace(/"/g, '\\"');
}

class SelectorRepairEngine {
  scoreCandidate(candidate, originalSelector) {
    let score = 0;

    const selector = candidate.selector || '';
    const original = String(originalSelector || '');

    if (candidate.attributeWeight) score += candidate.attributeWeight;
    if (selector.includes('[data-testid=')) score += 0.25;
    if (selector.includes('[data-id=')) score += 0.2;
    if (selector.includes('[aria-label=')) score += 0.15;
    if (selector.includes('#')) score += 0.08;
    if (selector.length < 80) score += 0.08;
    if (original && selector.includes(original.replace(/[.#]/g, ''))) score += 0.06;

    return Number(Math.min(score, 1).toFixed(3));
  }

  buildCandidates(elements = []) {
    const candidates = [];

    for (const element of elements) {
      const attrs = element.attributes || {};

      ATTRIBUTE_PRIORITIES.forEach((attr) => {
        if (attr.key === 'text') {
          if (element.text && element.text.length <= 80) {
            candidates.push({
              selector: `text=${quote(element.text.trim())}`,
              attribute: attr.key,
              attributeWeight: attr.weight,
            });
          }
          return;
        }

        if (attr.key === 'class') {
          if (attrs.class) {
            const stableClass = String(attrs.class)
              .split(/\s+/)
              .filter((part) => part && !/^(ng-|css-|sc-|Mui|chakra-)/.test(part))
              .slice(0, 2)
              .join('.');
            if (stableClass) {
              candidates.push({
                selector: `.${stableClass}`,
                attribute: attr.key,
                attributeWeight: attr.weight,
              });
            }
          }
          return;
        }

        if (attrs[attr.key]) {
          const value = quote(attrs[attr.key]);
          if (attr.key === 'id') {
            candidates.push({
              selector: `#${value}`,
              attribute: attr.key,
              attributeWeight: attr.weight,
            });
          }
          candidates.push({
            selector: `[${attr.key}="${value}"]`,
            attribute: attr.key,
            attributeWeight: attr.weight,
          });
        }
      });
    }

    return candidates;
  }

  repair(originalSelector, pageStateSnapshot = {}) {
    const elements = pageStateSnapshot.candidateElements || [];
    const rawCandidates = this.buildCandidates(elements);

    const dedup = new Map();
    for (const candidate of rawCandidates) {
      const score = this.scoreCandidate(candidate, originalSelector);
      const existing = dedup.get(candidate.selector);
      if (!existing || existing.score < score) {
        dedup.set(candidate.selector, {
          selector: candidate.selector,
          score,
          basedOn: candidate.attribute,
        });
      }
    }

    const candidates = [...dedup.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return {
      originalSelector,
      candidates,
      bestCandidate: candidates[0] || null,
    };
  }
}

module.exports = {
  SelectorRepairEngine,
  ATTRIBUTE_PRIORITIES,
};
