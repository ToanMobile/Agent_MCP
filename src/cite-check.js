// TU KIEM TRICH DAN file:dong (de xuat PM project Unity, 14/09/2026): PM_VERIFICATION_R2.md (T0001) co 27 trich dan
// code trong ban audit -> 3 dung, 4 lech dong, 20 la code KHONG ton tai trong file (vd GameProgressManager.cs:72
// "// TODO" — ca file khong co chu TODO). Kiem tra nay re, deterministic, khong can PM doc tay.
//
// Moi trich dan: { file, line, snippet? }. Nhan:
//   verified      — snippet co o dong do (± CUA_SO dong)
//   line-off      — snippet co trong file nhung o dong khac
//   not-found     — snippet KHONG co trong file (=> bia)
//   exists        — khong co snippet; file co, dong trong pham vi
//   line-out      — khong co snippet; dong vuot qua so dong cua file
//   file-missing  — file khong ton tai
import fs from 'node:fs';
import path from 'node:path';

export const CUA_SO = 3;
const CITE_RE = /(?:^|[\s(`'"\[])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,8}):(\d{1,6})(?=[\s)`'",\]:;.]|$)/g;

/** Tach moi "path:line" trong mot doan van. */
export function tachTrichDan(text) {
  const out = [];
  for (const m of String(text || '').matchAll(CITE_RE)) out.push({ file: m[1], line: Number(m[2]) });
  return out;
}

function chuanHoa(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/** Kiem MOT trich dan. */
export function kiemTrichDan(projectRoot, { file, line, snippet }) {
  const rel = String(file || '').replace(/^\.\//, '');
  const abs = path.isAbsolute(rel) ? rel : path.resolve(projectRoot, rel);
  let text;
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 4_000_000) return { file: rel, line, status: 'file-missing', note: st.isFile() ? 'file qua lon' : 'khong phai file' };
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return { file: rel, line, status: 'file-missing' };
  }
  const lines = text.split('\n');
  const sn = chuanHoa(snippet);
  if (!sn) {
    if (line && line > lines.length) return { file: rel, line, status: 'line-out', note: `file chi co ${lines.length} dong` };
    return { file: rel, line, status: 'exists' };
  }
  const khop = (i) => chuanHoa(lines[i] || '').includes(sn);
  if (line) {
    for (let i = Math.max(0, line - 1 - CUA_SO); i <= Math.min(lines.length - 1, line - 1 + CUA_SO); i += 1) {
      if (khop(i)) return { file: rel, line, status: 'verified', foundLine: i + 1 };
    }
  }
  for (let i = 0; i < lines.length; i += 1) if (khop(i)) return { file: rel, line, status: 'line-off', foundLine: i + 1 };
  return { file: rel, line, status: 'not-found' };
}

/** Gom trich dan tu mot object bao cao (findings[].file/snippet, facts_checked[].evidence/snippet, dod_check[].evidence, notes). */
export function trichDanTuBaoCao(report) {
  const out = [];
  const push = (spec, snippet) => {
    for (const c of tachTrichDan(spec)) out.push({ ...c, snippet: snippet || null, from: spec });
  };
  if (!report || typeof report !== 'object') return out;
  for (const f of Array.isArray(report.findings) ? report.findings : []) {
    if (f && typeof f === 'object') push(f.file, f.snippet);
  }
  for (const f of Array.isArray(report.facts_checked) ? report.facts_checked : []) {
    if (f && typeof f === 'object') push(f.evidence, f.snippet);
  }
  for (const d of Array.isArray(report.dod_check) ? report.dod_check : []) {
    if (d && typeof d === 'object') push(d.evidence, d.snippet);
  }
  if (typeof report.notes === 'string') push(report.notes, null);
  return out;
}

/**
 * Kiem ca bao cao. Tra ve { items, counts, bia } — bia = not-found (file co, dong code khong co: bia chac chan)
 * + file-missing (co the la chinh finding "file khong ton tai" => nguoi goi chi canh bao).
 */
export function kiemBaoCao(projectRoot, report) {
  const items = trichDanTuBaoCao(report).map((c) => ({ ...kiemTrichDan(projectRoot, c), snippet: c.snippet }));
  const counts = {};
  for (const it of items) counts[it.status] = (counts[it.status] || 0) + 1;
  const bia = items.filter((it) => it.status === 'not-found' || it.status === 'file-missing');
  return { items, counts, bia };
}

/** Mot dong tom tat cho PM. */
export function dongTomTat(kq) {
  if (!kq.items.length) return 'khong co trich dan file:dong nao de kiem';
  const c = kq.counts;
  return `${kq.items.length} trich dan: ${c.verified || 0} verified · ${c['line-off'] || 0} line-off · ${c['not-found'] || 0} NOT-FOUND · ${c.exists || 0} exists (khong snippet) · ${c['line-out'] || 0} line-out · ${c['file-missing'] || 0} FILE-MISSING`;
}
