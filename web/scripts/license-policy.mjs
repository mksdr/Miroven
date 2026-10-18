// Conservative rules for code combined with this AGPL-3.0-only project.
export const sources = {
  compatibility: "https://www.gnu.org/licenses/license-compatibility.en.html",
  licenses: "https://www.gnu.org/licenses/license-list.html",
  blueOak: "https://blueoakcouncil.org/license-faq",
};
const compatible = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Apache-2.0", "CC0-1.0", "Python-2.0", "BlueOak-1.0.0", "AGPL-3.0-only", "AGPL-3.0-or-later"]);
const incompatible = new Set(["GPL-2.0-only", "AGPL-1.0-only", "BSD-4-Clause", "CDDL-1.0", "CDDL-1.1"]);
const conditional = new Set(["LGPL-2.1-only", "LGPL-2.1-or-later", "LGPL-3.0", "LGPL-3.0-only", "LGPL-3.0-or-later", "MPL-2.0", "GPL-3.0-only", "GPL-3.0-or-later", "GPL-2.0-or-later", "CC-BY-4.0"]);

// OR has lower precedence than AND; WITH binds to one license identifier.
export function parseExpression(expression) {
  if (typeof expression !== "string" || !expression.trim()) throw new Error("Missing license expression");
  const tokens = expression.match(/\(|\)|[A-Za-z0-9.+:-]+/g) ?? [];
  if (tokens.join("") !== expression.replace(/\s/g, "")) throw new Error("Invalid license expression");
  let cursor = 0;
  function atom() {
    if (tokens[cursor] === "(") {
      cursor++;
      const result = or();
      if (tokens[cursor++] !== ")") throw new Error("Unclosed parenthesis");
      return result;
    }
    const id = tokens[cursor++];
    if (!id || ["AND", "OR", "WITH", ")"].includes(id)) throw new Error("Expected license identifier");
    if (tokens[cursor] === "WITH") {
      cursor++;
      const exception = tokens[cursor++];
      if (!exception || ["AND", "OR", "WITH", "(", ")"].includes(exception)) throw new Error("Expected exception identifier");
      return { type: "exception", id, exception };
    }
    return { type: "license", id };
  }
  function and() {
    let result = atom();
    while (tokens[cursor] === "AND") { cursor++; result = { type: "AND", left: result, right: atom() }; }
    return result;
  }
  function or() {
    let result = and();
    while (tokens[cursor] === "OR") { cursor++; result = { type: "OR", left: result, right: and() }; }
    return result;
  }
  const result = or();
  if (cursor !== tokens.length) throw new Error("Unexpected token");
  return result;
}

function evaluate(node) {
  if (node.type === "license") {
    if (compatible.has(node.id)) return { status: "pass", selected: node.id, reason: "등록된 AGPLv3 호환 규칙에 해당합니다. 개별 고지 및 배포 조건은 유지해야 합니다." };
    if (incompatible.has(node.id)) return { status: "incompatible", selected: node.id, reason: "AGPLv3 코드와 결합하는 경우 비호환으로 등록된 라이선스입니다." };
    return { status: "review", selected: node.id, reason: conditional.has(node.id) ? "결합 방식, 재라이선스 조건 또는 소스·고지 제공 의무의 검토가 필요합니다." : "등록되지 않았거나 사용자 정의된 라이선스입니다." };
  }
  if (node.type === "exception") return { status: "review", selected: `${node.id} WITH ${node.exception}`, reason: "예외 조항을 포함하므로 개별 검토가 필요합니다." };
  const left = evaluate(node.left), right = evaluate(node.right);
  const rank = { pass: 0, review: 1, incompatible: 2 };
  if (node.type === "OR") {
    const choice = rank[left.status] <= rank[right.status] ? left : right;
    return { ...choice, reason: `OR 선택: ${choice.selected}. ${choice.reason}` };
  }
  const status = rank[left.status] >= rank[right.status] ? left.status : right.status;
  return { status, selected: `(${left.selected} AND ${right.selected})`, reason: `모든 AND 조건이 적용됩니다. ${left.reason} ${right.reason}` };
}

export function assessLicense(expression, scope = "runtime") {
  let result;
  try { result = evaluate(parseExpression(expression)); }
  catch (error) { result = { status: "review", selected: null, reason: `라이선스 정보가 없거나 표현식이 잘못되었습니다: ${error.message}` }; }
  if (scope === "development" && result.status === "incompatible") {
    return { ...result, status: "review", reason: `개발 도구로 분류되었습니다. 배포 코드에 포함되는지 확인해야 합니다. ${result.reason}` };
  }
  return result;
}

export function applyReview(entry, result, reviews) {
  const review = reviews.find((item) => item.name === entry.name && item.location === entry.location);
  if (!review) return result;
  if (review.version !== entry.version || review.license !== entry.license) {
    return { ...result, status: "review", reason: "기존 수동 검토의 버전 또는 라이선스가 변경되었습니다. 다시 검토해야 합니다." };
  }
  return { ...result, status: review.status, reason: review.reason, manualReview: review };
}

export function validateReviews(reviews) {
  if (!Array.isArray(reviews)) throw new Error("Reviews must be an array");
  const seen = new Set();
  for (const review of reviews) {
    for (const key of ["name", "location", "version", "reason", "source", "reviewedBy", "reviewedAt"]) {
      if (typeof review[key] !== "string" || !review[key].trim()) throw new Error(`Invalid review field: ${key}`);
    }
    if (typeof review.license !== "string") throw new Error("Invalid review license");
    if (!["pass", "review", "incompatible"].includes(review.status)) throw new Error("Invalid review status");
    if (!/^https:\/\//.test(review.source) || !/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt)) throw new Error("Invalid review evidence/date");
    const key = `${review.name}:${review.location}`;
    if (seen.has(key)) throw new Error(`Duplicate review: ${key}`);
    seen.add(key);
  }
}
