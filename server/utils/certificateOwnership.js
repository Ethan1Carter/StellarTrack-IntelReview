// 模型只负责从附件提取获奖人；归属比较由服务端使用登录账号资料完成。
function normalized(value) {
  return String(value || '').normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff]/gu, '').toLocaleLowerCase();
}

function checkCertificateOwnership(identity, applicant, attachmentRead, document) {
  const expectedName = String(applicant?.realName || '').trim();
  const expectedStudentNo = String(applicant?.studentNo || '').trim();
  const recipients = (Array.isArray(identity?.recipients) ? identity.recipients : []).slice(0, 30)
    .filter(person => person && typeof person.name === 'string')
    .map(person => ({ name: person.name.trim().slice(0, 100),
      studentNo: typeof person.studentNo === 'string' ? person.studentNo.trim().slice(0, 100) : '',
      evidence: typeof person.evidence === 'string' ? person.evidence.trim().slice(0, 500) : '',
      page: Number.isInteger(person.page) ? person.page : document?.kind === 'pdf' ? null : 1 }));
  const result = { status: 'unverified', matchedBy: null, expectedName,
    recognizedRecipients: recipients, message: '', requiresManualReview: true };
  const finish = (status, message, matchedBy = null) => ({ ...result, status, message, matchedBy });

  if (!attachmentRead) return finish('unverified', '未读取附件正文，无法核验证书归属，请人工核验。');
  if (!expectedName) return finish('unverified', '当前账号未填写真实姓名，无法核对，请先完善身份信息。');
  if (!['individual_certificate', 'team_certificate'].includes(identity?.documentType)) {
    return finish('unverified', '未识别到个人或团队证书，不能确认材料归属，请人工核验。');
  }
  if (identity?.readable !== true || !recipients.length) {
    return finish('unverified', '未能清晰读取证书上的获奖人姓名，请补充清晰原件或团队成员证明。');
  }
  const valid = recipients.filter(person => normalized(person.name)
    && !/[＊*?？□�…]/u.test(person.name)
    && (!document || (person.page >= 1 && person.page <= document.pageCount))
    && normalized(person.evidence).includes(normalized(person.name)));
  if (valid.length !== recipients.length
      || (identity.documentType === 'individual_certificate' && valid.length !== 1)) {
    return finish('unverified', '获奖人姓名或原文依据不完整，无法可靠核对，请人工核验。');
  }
  const sameName = valid.filter(person => normalized(person.name) === normalized(expectedName));
  if (!sameName.length) {
    return finish('mismatch', `证书所列获奖人未包含当前账号姓名“${expectedName}”，请更换本人材料；如识别有误请人工核验。`);
  }
  const identified = sameName.filter(person => person.studentNo);
  if (identified.some(person => /[＊*?？□�…]/u.test(person.studentNo)
      || !normalized(person.evidence).includes(normalized(person.studentNo)))) {
    return finish('unverified', '姓名一致，但学号模糊或缺少学号原文依据，请人工核验。');
  }
  if (identified.length) {
    if (!expectedStudentNo) return finish('unverified', '姓名一致，但当前账号没有学号，无法完成证书学号核对。');
    if (identified.some(person => normalized(person.studentNo) === normalized(expectedStudentNo))) {
      return finish('matched', '证书姓名、学号与当前账号一致；此结果不代表证书真伪已验证，仍需教师复核。', 'name_and_student_no');
    }
    if (identified.some(person => normalized(person.studentNo).length !== normalized(expectedStudentNo).length)) {
      return finish('unverified', '姓名一致，但识别学号位数与账号不同，可能存在漏读或错读，请人工核验。');
    }
    return finish('mismatch', '证书姓名一致，但学号与当前账号不一致，请更换本人材料或申请人工核验。');
  }
  return finish('matched', '证书姓名与当前账号一致，但未读取到学号，无法排除同名情况；仍需教师核验原件。', 'name');
}

function applyOwnershipCheck(review, identity, applicant, attachmentRead, document) {
  const ownership = checkCertificateOwnership(identity, applicant, attachmentRead, document);
  const riskFlags = [...review.riskFlags];
  riskFlags.push({ code: `ownership_${ownership.status}`, label: ownership.message,
    severity: ownership.status === 'matched' ? 'medium' : 'high' });
  return { ...review, ownership, riskFlags,
    scoreSuggestion: ownership.status === 'matched' ? review.scoreSuggestion : null,
    nextAction: ownership.status === 'matched' ? review.nextAction : ownership.message };
}

module.exports = { checkCertificateOwnership, applyOwnershipCheck };
