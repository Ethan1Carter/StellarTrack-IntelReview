// 只合并展示用的相同页码、相同原文，保留审核结果中的逐人依据。
export function groupReviewEvidence(review) {
  const groups = new Map();
  let missingIndex = 0;
  function groupFor(item) {
    const evidence = typeof item.evidence === 'string' ? item.evidence.trim() : '';
    const page = Number.isInteger(item.page) && item.page > 0 ? item.page : null;
    const key = evidence
      ? JSON.stringify([page, evidence.replace(/\s+/gu, '')])
      : `missing-${missingIndex++}`;
    if (!groups.has(key)) groups.set(key, { key, page, evidence, recipients: [], facts: [] });
    return groups.get(key);
  }
  for (const person of review?.ownership?.recognizedRecipients || []) {
    const group = groupFor(person);
    const name = person.name || '姓名不清晰';
    const studentNo = person.studentNo || '';
    if (!group.recipients.some(item => item.name === name && item.studentNo === studentNo)) {
      group.recipients.push({ name, studentNo });
    }
  }
  for (const fact of review?.sourceFacts || []) {
    const group = groupFor(fact);
    if (fact.value && !group.facts.includes(fact.value)) group.facts.push(fact.value);
  }
  return [...groups.values()];
}
