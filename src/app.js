import { QUESTION_TYPES } from './core/config.js';
import { systemClock } from './core/dates.js';
import { evaluateEnglishAnswer } from './core/answer-evaluator.js';
import { applyAnswer, markIntroduced } from './core/review-engine.js';
import { openDatabase, putOne, readAll } from './data/db.js';
import {
  activateNextPack, canDeleteUnstartedPack, clearProfileProgress, completePackIfReady,
  deleteUnstartedPack, ensureDefaultProfiles, getProfile, importPack, listAttempts,
  listPacks, listProfiles, listProgress, listWords, markPackStarted, saveProfile,
  saveSession, saveStudyStep, switchActivePack, updatePack, wordsForPack,
} from './data/repositories.js';
import {
  buildCsvText, csvFileName, naturalFileSort, prepareCsvImport, preparePastedImport,
} from './services/csv-service.js';
import { buildSession, requeueTask } from './services/session-service.js';
import { loadEnglishVoices, speak, speechAvailable, stopSpeech, testSystemSpeech } from './services/speech-service.js';
import { TEST_VOCABULARY } from './services/sample-vocabulary.js';
import { createBackup, restoreBackup } from './services/backup-service.js';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const state = {
  profiles: [], profile: null, session: null, currentWord: null, hintLevel: 0,
  feedback: null, revealMeaning: false, pendingPasteImport: null,
};
const labels = { locked: '未解锁', available: '已解锁', active: '学习中', completed: '已通关', archived: '已归档' };
const SOUND_READY_KEY = 'wordHeroSoundReady';

function showToast(message) {
  toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function soundReady() { return localStorage.getItem(SOUND_READY_KEY) === 'true'; }
function markSoundReady() { localStorage.setItem(SOUND_READY_KEY, 'true'); }
function playWord(word, manual = false) {
  const played = speak(word, state.profile?.settings.speechRate, state.profile?.settings.voiceURI || '');
  if (played && manual) markSoundReady();
  return played;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function navigate(route) { location.hash = route.startsWith('#/') ? route : `#/${route}`; }
function routeName() { return (location.hash || '#/profiles').slice(2).split('/')[0] || 'profiles'; }

function page(content, active = '') {
  if (!state.profile) return `<main class="shell">${brand()}${content}</main>`;
  const nav = [['home','学习首页'],['packs','词包'],['report','报告'],['settings','设置']]
    .map(([route,label]) => `<a class="${active === route ? 'active' : ''}" href="#/${route}">${label}</a>`).join('');
  return `<main class="shell"><header class="topbar">${brand()}<span class="spacer"></span><button class="profile-pill" data-action="switch-profile"><span class="avatar ${state.profile.avatarColor}">${escapeHtml(state.profile.name.slice(0,1))}</span><span>${escapeHtml(state.profile.name)}</span></button></header><nav class="nav">${nav}</nav>${content}</main>`;
}

function brand() { return `<div class="brand"><span class="brand-mark">★</span><span>单词小勇士</span></div>`; }

async function seedTestVocabulary() {
  for (const profile of state.profiles) {
    if ((await listPacks(profile.id)).length) continue;
    const words = TEST_VOCABULARY[profile.id];
    for (const [index, group] of [words.slice(0, 4), words.slice(4)].entries()) {
      document.querySelector('.loading').textContent = `正在装入 ${profile.name}的第 ${index + 1} 个测试词包…`;
      const validRows = group.map(([word, meaning]) => ({ word, meaning, meaningParts: meaning.split('；'), wordKey: word.toLowerCase() }));
      await importPack(profile.id, { fileName: `内置测试词库${index + 1}.csv`, proposedPackName: `第${index + 1}关 · 测试词库`, validRows }, { seed: true });
    }
  }
}

async function loadProfile(profileId) {
  state.profile = profileId ? await getProfile(profileId) : null;
  if (state.profile) localStorage.setItem('wordHeroActiveProfile', profileId);
}

async function dashboard(profileId) {
  const [packs, progress] = await Promise.all([listPacks(profileId), listProgress(profileId)]);
  const activePack = packs.find((item) => item.status === 'active');
  const packWords = activePack ? await wordsForPack(profileId, activePack.id) : [];
  return {
    packs, activePack, due: progress.filter((item) => item.currentlyMastered && item.nextReviewDate && item.nextReviewDate <= systemClock.today()).length,
    learned: progress.filter((item) => item.introduced).length,
    mastered: progress.filter((item) => item.currentlyMastered).length,
    longTerm: progress.filter((item) => item.longTermMastered).length,
    total: progress.length, packMastered: packWords.filter((item) => item.progress.currentlyMastered).length,
    packTotal: packWords.length,
  };
}

async function renderProfiles() {
  state.profile = null; localStorage.removeItem('wordHeroActiveProfile');
  const cards = await Promise.all(state.profiles.map(async (profile) => {
    const data = await dashboard(profile.id);
    return `<button class="card profile-card" data-profile="${profile.id}"><span class="avatar ${profile.avatarColor}">${escapeHtml(profile.name.slice(0,1))}</span><div><span class="eyebrow">${profile.grade === 'grade5' ? '五年级' : '初三'}</span><h2>${escapeHtml(profile.name)}</h2><p class="muted">${escapeHtml(data.activePack?.name || '暂无当前词包')} · 今日复习 ${data.due} 个</p></div></button>`;
  }));
  app.innerHTML = page(`<section class="hero"><span class="eyebrow">Choose your hero</span><h1>今天，谁来闯关？</h1><p>每位小勇士都有完全独立的词库和学习进度。</p></section><section class="grid">${cards.join('')}</section>`);
}

async function renderHome() {
  const data = await dashboard(state.profile.id);
  const percent = data.packTotal ? Math.round(data.packMastered / data.packTotal * 100) : 0;
  const soundSetup = soundReady() ? '' : `<article class="card full note"><h3>先开启声音</h3><p>浏览器要求先点击一次，之后学习卡才能自动播放发音。</p><button class="primary" data-action="enable-sound">🔊 开启并试听</button></article>`;
  app.innerHTML = page(`<section class="hero"><span class="eyebrow">Today's quest</span><h1>${data.due ? `有 ${data.due} 个词等你复习` : '准备好继续闯关了吗？'}</h1><p>${escapeHtml(data.activePack?.name || '所有测试词包已完成')} · 当前进度 ${percent}%</p><button class="primary" data-action="start-study">${state.session ? '继续学习' : '开始学习'}</button></section><section class="grid">${soundSetup}<article class="card"><span class="eyebrow">当前词包</span><div class="metric">${data.packMastered} / ${data.packTotal}</div><div class="progress"><span style="width:${percent}%"></span></div></article><article class="card"><span class="eyebrow">今日待复习</span><div class="metric">${data.due}</div><p class="muted">到期单词会优先出现</p></article><article class="card"><span class="eyebrow">当前掌握</span><div class="metric">${data.mastered}</div><p class="muted">共学习过 ${data.learned} 个词</p></article><article class="card"><span class="eyebrow">长期掌握</span><div class="metric">${data.longTerm}</div><p class="muted">完成全部复习阶段</p></article></section>`, 'home');
}

async function renderPacks() {
  state.pendingPasteImport = null;
  const packs = await listPacks(state.profile.id);
  const deletable = new Map(await Promise.all(packs.map(async (pack) => [pack.id, await canDeleteUnstartedPack(state.profile.id, pack.id)])));
  const rows = packs.map((pack) => {
    const canSwitch = !['active', 'completed', 'archived'].includes(pack.status);
    const sourceLabel = pack.sourceType === 'paste' ? ' · 粘贴创建' : pack.isTestData ? ' · 测试数据' : ' · CSV 导入';
    const controls = `${canSwitch ? `<button class="ghost compact" data-action="switch-pack" data-pack-id="${escapeHtml(pack.id)}">切换到此词包</button>` : ''}<button class="ghost compact" data-action="export-pack" data-pack-id="${escapeHtml(pack.id)}" data-pack-name="${escapeHtml(pack.name)}">导出 CSV</button>${deletable.get(pack.id) ? `<button class="danger compact" data-action="delete-pack" data-pack-id="${escapeHtml(pack.id)}">删除未开始词包</button>` : ''}`;
    return `<div class="pack-row"><div><strong>${escapeHtml(pack.name)}</strong><div class="muted">${pack.wordCount} 个单词${sourceLabel}${pack.startedAt ? ' · 已开始' : ''}</div></div><div class="pack-actions"><span class="status ${pack.status}">${labels[pack.status]}</span><div class="actions">${controls}</div></div></div>`;
  }).join('');
  app.innerHTML = page(`<section class="grid"><article class="card full"><h2>添加词包</h2><p class="muted">可以直接粘贴“英文＋中文释义”，也可以继续导入一个或多个 CSV 文件。</p><div class="import-methods"><section class="import-method"><span class="eyebrow">推荐</span><h3>粘贴单词</h3><p class="muted">从 Excel、WPS 或两列表格中复制，创建前可以检查预览。</p><button class="primary" data-action="open-paste">粘贴单词</button></section><section class="import-method"><span class="eyebrow">保留原方式</span><h3>导入 CSV</h3><div class="dropzone" id="dropzone"><p><strong>拖放 CSV 到这里</strong><br><span class="muted">或从设备中选择一个或多个文件</span></p><input id="csv-input" type="file" accept=".csv,text/csv" multiple hidden><button class="ghost" data-action="pick-csv">选择 CSV</button></div></section></div><section class="paste-panel" id="paste-panel" hidden><h3>创建粘贴词包</h3><label class="form-row">词包名称<input id="paste-pack-name" maxlength="80" placeholder="例如：五年级 Unit 3"></label><label class="form-row">英文和中文释义<textarea id="paste-words" rows="10" spellcheck="false" placeholder="apple&#9;苹果&#10;important&#9;重要的；重要性大的"></textarea></label><p class="muted">推荐直接从 Excel 或 WPS 复制两列；也支持带 <code>word,meaning</code> 表头的 CSV 文本。</p><div class="actions"><button class="secondary" data-action="preview-paste">检查并预览</button><button class="ghost" data-action="cancel-paste">取消</button></div><div id="paste-preview"></div></section><div id="import-report"></div></article><article class="card full"><span class="eyebrow">家长操作</span><h2>${escapeHtml(state.profile.name)}的词包</h2><p class="muted">同一时间只会有一个“学习中”词包。切换、更新或导出都不会清除、重算已学单词的复习日期。</p>${rows || '<p class="empty">还没有词包</p>'}</article></section>`, 'packs');
  bindDropzone();
}

function chooseDuplicateImport(existing, parsed) {
  if (existing.status === 'completed') {
    return confirm(`已存在同名且已通关的词包“${parsed.proposedPackName}”。为保护通关记录，不能覆盖更新。\n\n确定：作为新的独立词包导入\n取消：跳过这个文件`) ? 'new' : 'skip';
  }
  if (confirm(`已存在同名词包“${parsed.proposedPackName}”。\n\n确定：更新现有词包（保留全部学习进度和复习日期）\n取消：查看其他选择`)) return 'update';
  if (confirm(`要把“${parsed.proposedPackName}”作为一个新的独立词包继续导入吗？\n\n确定：作为新词包导入\n取消：跳过这个文件`)) return 'new';
  return 'skip';
}

async function saveParsedPack(parsed) {
  const packs = await listPacks(state.profile.id);
  const sameName = packs.filter((pack) => pack.name.trim().toLocaleLowerCase() === parsed.proposedPackName.trim().toLocaleLowerCase()).at(-1);
  const mode = sameName ? chooseDuplicateImport(sameName, parsed) : 'new';
  if (mode === 'skip') return { skipped: true, message: `发现同名词包“${parsed.proposedPackName}”，已跳过` };
  if (mode === 'update') {
    await updatePack(state.profile.id, sameName.id, parsed);
    return { skipped: false, message: `已更新“${parsed.proposedPackName}”，学习进度和复习日期保持不变` };
  }
  await importPack(state.profile.id, parsed);
  return { skipped: false, message: `已创建“${parsed.proposedPackName}”：${parsed.validRows.length} 个单词，${parsed.errors.length} 行跳过` };
}

async function handleFiles(fileList) {
  const files = [...fileList].filter((file) => file.name.toLowerCase().endsWith('.csv')).sort(naturalFileSort);
  if (!files.length) return showToast('请选择 CSV 文件');
  const reports = [];
  for (const file of files) {
    try {
      const parsed = prepareCsvImport(await file.text(), file.name);
      const result = await saveParsedPack(parsed);
      reports.push(`${result.skipped ? '—' : '✓'} ${file.name}：${result.message}`);
    } catch (error) { reports.push(`✕ ${file.name}：${error.message}`); }
  }
  showToast(`已处理 ${files.length} 个文件`);
  await renderPacks();
  document.querySelector('#import-report').innerHTML = `<div class="note" style="margin-top:16px">${reports.map(escapeHtml).join('<br>')}</div>`;
}

function pastePayload() {
  return {
    packName: document.querySelector('#paste-pack-name')?.value || '',
    text: document.querySelector('#paste-words')?.value || '',
  };
}

function previewPastedWords() {
  const preview = document.querySelector('#paste-preview');
  try {
    const payload = pastePayload();
    const parsed = preparePastedImport(payload.text, payload.packName);
    const signature = `${payload.packName}\u0000${payload.text}`;
    state.pendingPasteImport = { parsed, signature };
    const samples = parsed.validRows.slice(0, 8).map((row) => `<div class="preview-row"><strong>${escapeHtml(row.word)}</strong><span>${escapeHtml(row.meaning)}</span></div>`).join('');
    const remainder = parsed.validRows.length > 8 ? `<p class="muted">还有 ${parsed.validRows.length - 8} 个单词未在预览中展开。</p>` : '';
    const errors = parsed.errors.length
      ? `<p class="paste-warning">将跳过 ${parsed.errors.length} 行：${parsed.errors.slice(0, 5).map((error) => `第 ${error.rowNumber} 行${error.message}`).join('；')}</p>`
      : '';
    preview.innerHTML = `<div class="paste-preview"><h4>预览：${escapeHtml(parsed.proposedPackName)}</h4><p><strong>${parsed.validRows.length}</strong> 个有效单词 · ${parsed.duplicateRows} 个重复项 · ${parsed.mergedMeanings} 个释义已合并</p><div class="preview-list">${samples}</div>${remainder}${errors}<div class="actions"><button class="primary" data-action="import-paste">确认创建词包</button></div></div>`;
  } catch (error) {
    state.pendingPasteImport = null;
    preview.innerHTML = `<div class="note paste-error">${escapeHtml(error.message)}</div>`;
  }
}

async function importPastedWords() {
  const payload = pastePayload();
  const signature = `${payload.packName}\u0000${payload.text}`;
  if (!state.pendingPasteImport || state.pendingPasteImport.signature !== signature) {
    previewPastedWords();
    showToast('内容有变化，请检查预览后再确认');
    return;
  }
  try {
    const result = await saveParsedPack(state.pendingPasteImport.parsed);
    if (result.skipped) return showToast(result.message);
    await renderPacks();
    document.querySelector('#import-report').innerHTML = `<div class="note success-note">${escapeHtml(result.message)}。你可以在词包列表中导出 CSV。</div>`;
    showToast('粘贴词包已保存');
  } catch (error) {
    showToast(error.message);
  }
}

async function exportPackCsv(packId, packName) {
  const name = csvFileName(packName);
  let fileHandle = null;
  if ('showSaveFilePicker' in window) {
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'CSV 词包', accept: { 'text/csv': ['.csv'] } }],
      });
    } catch (error) {
      if (error.name === 'AbortError') return;
      fileHandle = null;
    }
  }

  const rows = await wordsForPack(state.profile.id, packId);
  const contents = buildCsvText(rows);
  if (fileHandle) {
    const writable = await fileHandle.createWritable();
    await writable.write(contents);
    await writable.close();
    showToast(`已保存 ${name}`);
    return;
  }

  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('CSV 已交给浏览器下载');
}

function bindDropzone() {
  const zone = document.querySelector('#dropzone'); const input = document.querySelector('#csv-input');
  input.addEventListener('change', () => handleFiles(input.files));
  ['dragenter','dragover'].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave','drop'].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (event) => handleFiles(event.dataTransfer.files));
}

async function getCurrentWord(task) {
  return (await listWords(state.profile.id)).find((word) => word.wordKey === task.wordKey);
}

async function renderStudy() {
  state.session = await buildSession(state.profile, systemClock.today(), speechAvailable);
  if (!state.session.taskQueue.length || state.session.currentIndex >= state.session.taskQueue.length) {
    if (state.session.status !== 'completed') { state.session.status = 'completed'; state.session.endedAt = new Date().toISOString(); await saveSession(state.session); }
    return navigate('result');
  }
  const task = state.session.taskQueue[state.session.currentIndex];
  const word = await getCurrentWord(task); state.currentWord = word;
  if (!word) throw new Error('学习任务中的单词不存在');
  const progressText = `${Math.min(state.session.currentIndex + 1, state.session.taskQueue.length)} / ${state.session.taskQueue.length}`;
  if (task.kind === 'intro') {
    app.innerHTML = page(`<section class="study-card"><span class="eyebrow">认识新伙伴 · ${progressText}</span><div class="prompt">${escapeHtml(word.word)}</div><h2>${escapeHtml(word.meaning)}</h2><div class="actions"><button class="ghost" data-action="speak">🔊 听发音</button><button class="primary" data-action="finish-intro">开始练习</button></div><p class="muted" style="margin-top:22px">听一听，再大声跟读一遍。</p></section>`, 'home');
    if (state.profile.settings.autoSpeak && soundReady()) playWord(word.word);
    return;
  }
  state.hintLevel = 0; state.feedback = null; state.revealMeaning = false;
  renderQuestion(task, word, progressText);
}

function renderQuestion(task, word, progressText) {
  const isMeaning = task.questionType === QUESTION_TYPES.ENGLISH_TO_MEANING;
  const title = task.questionType === QUESTION_TYPES.AUDIO_TO_ENGLISH ? '听音写单词' : isMeaning ? '回忆中文意思' : '看中文写英文';
  const prompt = task.questionType === QUESTION_TYPES.AUDIO_TO_ENGLISH ? '<button class="ghost" data-action="speak">🔊 播放英文</button>' : escapeHtml(isMeaning ? word.word : word.meaning);
  const form = isMeaning
    ? `<button class="primary" data-action="reveal-meaning">我想好了，查看答案</button>`
    : `<input class="answer-input" id="answer" lang="en" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="英文答案"><div class="actions"><button class="ghost" data-action="hint">提示</button><button class="primary" data-action="submit-answer">提交答案</button></div><div id="hint-text" class="muted" style="margin-top:16px"></div>`;
  app.innerHTML = page(`<section class="study-card"><span class="eyebrow">${title} · ${progressText}</span><div class="prompt">${prompt}</div><div id="question-controls">${form}</div></section>`, 'home');
  if (task.questionType === QUESTION_TYPES.AUDIO_TO_ENGLISH && soundReady()) playWord(word.word);
  document.querySelector('#answer')?.focus();
}

async function finishIntro() {
  const task = state.session.taskQueue[state.session.currentIndex];
  const allProgress = await listProgress(state.profile.id);
  const progress = allProgress.find((item) => item.wordKey === task.wordKey);
  if (task.packId) await markPackStarted(state.profile.id, task.packId);
  await putOne('progress', markIntroduced(progress, new Date().toISOString()));
  state.session.currentIndex += 1; await saveSession(state.session); await renderStudy();
}

function showHint() {
  state.hintLevel = Math.min(state.hintLevel + 1, 4);
  const word = state.currentWord.word;
  const hints = [`这个词有 ${word.length} 个字符`, `首字母是 ${word[0]}`, `${word[0]}${' ·'.repeat(Math.max(0, word.length - 2))} ${word.at(-1)}`, `答案：${word}`];
  document.querySelector('#hint-text').textContent = hints[state.hintLevel - 1];
}

async function submitResult(result, rawAnswer = '') {
  const task = state.session.taskQueue[state.session.currentIndex];
  const timestamp = new Date().toISOString(); const today = systemClock.today();
  const progress = (await listProgress(state.profile.id)).find((item) => item.wordKey === task.wordKey);
  const isEnglishInput = task.questionType !== QUESTION_TYPES.ENGLISH_TO_MEANING;
  const transition = applyAnswer(progress, { result, isEnglishInput, isScheduledReview: task.source === 'review', today, timestamp });
  const summaryResult = result === 'revealed' ? 'wrong' : result;
  state.session.summary.total += 1; state.session.summary[summaryResult] += 1;
  if (transition.becameMastered) state.session.summary.newlyMastered += 1;
  if (!state.session.summary.practicedWords.includes(task.wordKey)) state.session.summary.practicedWords.push(task.wordKey);
  state.session.currentIndex += 1;
  if (transition.needsRemediation) requeueTask(state.session, task, transition.progress, speechAvailable(task.wordKey));
  if (state.session.currentIndex >= state.session.taskQueue.length) { state.session.status = 'completed'; state.session.endedAt = timestamp; }
  const attempt = { profileId: state.profile.id, wordKey: task.wordKey, sessionId: state.session.id, timestamp, localDate: today, questionType: task.questionType, rawAnswer, normalizedAnswer: rawAnswer.trim().toLowerCase(), result, hintLevel: state.hintLevel, responseDurationMs: null, reviewStageBefore: progress.reviewStage, reviewStageAfter: transition.progress.reviewStage };
  await saveStudyStep({ attempt, progress: transition.progress, session: state.session });
  const packs = await listPacks(state.profile.id); const active = packs.find((item) => item.status === 'active');
  if (active && transition.becameMastered) await completePackIfReady(state.profile.id, active.id);
  const className = summaryResult; const title = result === 'correct' ? '答对了！' : result === 'fuzzy' ? '很接近，再练一次' : '没关系，记住它';
  document.querySelector('#question-controls').innerHTML = `<div class="feedback ${className}"><strong>${title}</strong><br>正确答案：${escapeHtml(state.currentWord.word)} · ${escapeHtml(state.currentWord.meaning)}</div><div class="actions"><button class="primary" data-action="next-question">下一题</button></div>`;
  if (soundReady()) playWord(state.currentWord.word);
}

async function renderResult() {
  let session = state.session;
  if (!session) session = (await readAll('sessions')).filter((item) => item.profileId === state.profile.id && item.status === 'completed').sort((a,b) => (b.endedAt || '').localeCompare(a.endedAt || ''))[0];
  const summary = session?.summary || { total:0,correct:0,fuzzy:0,wrong:0,newlyMastered:0 };
  const packs = await listPacks(state.profile.id); const available = packs.find((item) => item.status === 'available');
  app.innerHTML = page(`<section class="hero"><span class="eyebrow">Quest complete</span><h1>本轮完成！</h1><p>你练习了 ${summary.total} 道题，又向前走了一大步。</p></section><section class="grid"><article class="card"><span class="eyebrow">完全正确</span><div class="metric">${summary.correct}</div></article><article class="card"><span class="eyebrow">模糊 / 错误</span><div class="metric">${summary.fuzzy} / ${summary.wrong}</div></article><article class="card"><span class="eyebrow">新掌握单词</span><div class="metric">${summary.newlyMastered}</div></article><article class="card"><h3>${available ? '新词包已解锁！' : '还想再练一轮？'}</h3><div class="actions">${available ? '<button class="primary" data-action="activate-next">进入下一词包</button>' : '<button class="primary" data-action="new-session">继续练习</button>'}<button class="secondary" data-action="go-home">返回首页</button></div></article></section>`, 'home');
}

async function renderReport() {
  const data = await dashboard(state.profile.id); const attempts = await listAttempts(state.profile.id);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 6); const sevenDays = attempts.filter((item) => new Date(item.timestamp) >= cutoff);
  const accuracy = sevenDays.length ? Math.round(sevenDays.filter((item) => item.result === 'correct').length / sevenDays.length * 100) : 0;
  const wrongMap = new Map(); attempts.filter((item) => item.result === 'wrong' || item.result === 'revealed').forEach((item) => wrongMap.set(item.wordKey, (wrongMap.get(item.wordKey) || 0) + 1));
  const trouble = [...wrongMap].sort((a,b) => b[1]-a[1]).slice(0,5);
  app.innerHTML = page(`<section class="hero"><span class="eyebrow">Learning report</span><h1>${escapeHtml(state.profile.name)}的成长记录</h1><p>报告只统计当前孩子，不会和另一位小勇士混在一起。</p></section><section class="grid"><article class="card"><span class="eyebrow">已学习 / 当前掌握</span><div class="metric">${data.learned} / ${data.mastered}</div></article><article class="card"><span class="eyebrow">近 7 天正确率</span><div class="metric">${accuracy}%</div></article><article class="card"><span class="eyebrow">长期掌握</span><div class="metric">${data.longTerm}</div></article><article class="card"><span class="eyebrow">已通关词包</span><div class="metric">${data.packs.filter((p) => p.status === 'completed').length}</div></article><article class="card full"><h2>需要多关照的词</h2>${trouble.length ? trouble.map(([word,count]) => `<div class="pack-row"><strong>${escapeHtml(word)}</strong><span>${count} 次错误</span></div>`).join('') : '<p class="muted">还没有错词记录，继续保持！</p>'}</article></section>`, 'report');
}

async function renderSettings() {
  const p = state.profile;
  const voices = await loadEnglishVoices();
  const voiceOptions = voices.length
    ? voices.map((voice) => `<option value="${escapeHtml(voice.voiceURI)}" ${p.settings.voiceURI === voice.voiceURI ? 'selected' : ''}>${escapeHtml(voice.name)} (${escapeHtml(voice.lang)})</option>`).join('')
    : '<option value="">没有检测到系统英文语音</option>';
  const speechNote = voices.length
    ? `检测到 ${voices.length} 个英文语音。测试词使用内置音频，其他任意英文词使用这里选择的系统语音。`
    : '没有检测到可用的系统英文语音。测试词仍可发音；自行导入的任意单词请在装有英文语音的 Chrome、Edge 或 Safari 中使用。';
  app.innerHTML = page(`<section class="grid"><form class="card" id="settings-form"><h2>个人设置</h2><label class="form-row">昵称<input name="name" value="${escapeHtml(p.name)}" maxlength="20" required></label><label class="form-row">每轮新词数<input name="newWords" type="number" min="1" max="50" value="${p.settings.newWordsPerSession}"></label><label class="form-row">发音速度<select name="speechRate"><option value="0.7" ${p.settings.speechRate===0.7?'selected':''}>慢速</option><option value="0.85" ${p.settings.speechRate===0.85?'selected':''}>标准</option><option value="1" ${p.settings.speechRate===1?'selected':''}>快速</option></select></label><label class="form-row">英文语音<select name="voiceURI" ${voices.length ? '' : 'disabled'}><option value="">自动选择英文语音</option>${voiceOptions}</select></label><label><input name="autoSpeak" type="checkbox" ${p.settings.autoSpeak?'checked':''}> 自动播放发音</label><p class="muted">${speechNote}</p><div class="actions"><button class="ghost" type="button" data-action="test-system-speech" ${voices.length ? '' : 'disabled'}>🔊 试听任意词发音</button><button class="primary" type="submit">保存设置</button></div></form><article class="card"><h2>备份与恢复</h2><p class="muted">所有数据只保存在当前浏览器。建议定期导出完整备份。</p><div class="actions"><button class="primary" data-action="export-backup">导出完整备份</button><button class="ghost" data-action="pick-backup">恢复备份</button><input id="backup-input" type="file" accept="application/json,.json" hidden></div></article><article class="card full"><h2>危险操作</h2><p class="muted">重置会清除当前孩子的答题记录和掌握进度，但保留词包。</p><button class="danger" data-action="reset-progress">重置当前孩子进度</button></article></section>`, 'settings');
  document.querySelector('#settings-form').addEventListener('submit', saveSettings);
  document.querySelector('#backup-input').addEventListener('change', restoreFromInput);
}

async function saveSettings(event) {
  event.preventDefault(); const data = new FormData(event.currentTarget);
  state.profile = await saveProfile({ ...state.profile, name: data.get('name').trim(), settings: { ...state.profile.settings, newWordsPerSession: Math.min(50, Math.max(1, Number(data.get('newWords')))), speechRate: Number(data.get('speechRate')), voiceURI: data.get('voiceURI') || '', autoSpeak: data.get('autoSpeak') === 'on' } });
  state.profiles = await listProfiles(); showToast('设置已保存'); renderSettings();
}

async function exportBackup() {
  const backup = await createBackup(); const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `单词小勇士备份_${systemClock.today()}.json`; link.click(); URL.revokeObjectURL(url); showToast('完整备份已导出');
}

async function restoreFromInput(event) {
  const file = event.target.files[0]; if (!file) return;
  try { const backup = JSON.parse(await file.text()); if (!confirm(`将用 ${backup.exportedAt?.slice(0,10) || '未知日期'} 的备份覆盖当前全部数据，确定吗？`)) return; await restoreBackup(backup); state.profiles = await listProfiles(); await loadProfile(localStorage.getItem('wordHeroActiveProfile')); showToast('备份恢复成功'); await render(); } catch (error) { showToast(`恢复失败：${error.message}`); }
}

async function render() {
  try {
    const route = routeName();
    if (route === 'profiles') return renderProfiles();
    if (!state.profile) return navigate('profiles');
    if (route === 'home') return renderHome();
    if (route === 'packs') return renderPacks();
    if (route === 'study') return renderStudy();
    if (route === 'result') return renderResult();
    if (route === 'report') return renderReport();
    if (route === 'settings') return renderSettings();
    navigate('home');
  } catch (error) { console.error(error); app.innerHTML = page(`<section class="card full"><h2>遇到一个问题</h2><p>${escapeHtml(error.message)}</p><button class="primary" data-action="go-home">返回首页</button></section>`); }
}

app.addEventListener('click', async (event) => {
  const profileButton = event.target.closest('[data-profile]');
  if (profileButton) { await loadProfile(profileButton.dataset.profile); state.session = null; navigate('home'); return; }
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  if (action === 'switch-profile') { stopSpeech(); state.session = null; navigate('profiles'); }
  if (action === 'enable-sound') {
    if (playWord(state.currentWord?.word || 'apple', true)) {
      showToast('声音已开启；后续学习卡会自动播放');
      if (routeName() === 'home') await renderHome();
    } else showToast('无法开启声音，请检查浏览器的声音权限');
  }
  if (action === 'start-study') navigate('study');
  if (action === 'pick-csv') document.querySelector('#csv-input').click();
  if (action === 'open-paste') {
    const panel = document.querySelector('#paste-panel');
    panel.hidden = false;
    document.querySelector('#paste-pack-name').focus();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (action === 'cancel-paste') {
    state.pendingPasteImport = null;
    document.querySelector('#paste-panel').hidden = true;
  }
  if (action === 'preview-paste') previewPastedWords();
  if (action === 'import-paste') {
    button.disabled = true;
    await importPastedWords();
    if (button.isConnected) button.disabled = false;
  }
  if (action === 'export-pack') {
    button.disabled = true;
    try { await exportPackCsv(button.dataset.packId, button.dataset.packName); }
    catch (error) { showToast(`导出失败：${error.message}`); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  if (action === 'switch-pack') {
    const packs = await listPacks(state.profile.id); const pack = packs.find((item) => item.id === button.dataset.packId);
    if (pack && confirm(`家长确认：把“${pack.name}”设为当前词包吗？\n\n原词包会暂停；已学单词的复习日期保持不变。`)) {
      await switchActivePack(state.profile.id, pack.id); state.session = null; showToast(`已切换到“${pack.name}”`); await renderPacks();
    }
  }
  if (action === 'delete-pack') {
    const packs = await listPacks(state.profile.id); const pack = packs.find((item) => item.id === button.dataset.packId);
    if (pack && confirm(`确定删除尚未开始的词包“${pack.name}”吗？\n\n只删除词包关系，不会清除任何已学单词的进度或复习日期。`)) {
      try { await deleteUnstartedPack(state.profile.id, pack.id); state.session = null; showToast('未开始词包已删除'); await renderPacks(); }
      catch (error) { showToast(error.message); }
    }
  }
  if (action === 'speak' && !playWord(state.currentWord?.word || '', true)) showToast('当前浏览器无法为这个词发音，请用 Safari、Chrome 或 Edge 播放');
  if (action === 'test-system-speech') {
    const formData = new FormData(button.closest('form'));
    button.disabled = true;
    const started = await testSystemSpeech(Number(formData.get('speechRate')), formData.get('voiceURI') || '');
    button.disabled = false;
    if (started) { markSoundReady(); showToast('系统英文语音已启动；如果没听见，请检查浏览器或系统音量'); }
    else showToast('系统英文语音启动失败，请换一个语音或浏览器');
  }
  if (action === 'finish-intro') await finishIntro();
  if (action === 'hint') showHint();
  if (action === 'submit-answer') { const input = document.querySelector('#answer'); if (!input.value.trim()) return showToast('先写下你的答案'); const evaluation = evaluateEnglishAnswer(input.value, state.currentWord.word, state.hintLevel); await submitResult(evaluation.result, input.value); }
  if (action === 'reveal-meaning') document.querySelector('#question-controls').innerHTML = `<div class="feedback"><strong>${escapeHtml(state.currentWord.meaning)}</strong></div><p>你刚才想对了吗？</p><div class="actions"><button class="primary" data-self-result="correct">答对了</button><button class="secondary" data-self-result="fuzzy">有点模糊</button><button class="danger" data-self-result="wrong">不会</button></div>`;
  if (action === 'next-question') await renderStudy();
  if (action === 'go-home') { state.session = null; navigate('home'); }
  if (action === 'new-session') { state.session = null; navigate('study'); }
  if (action === 'activate-next') { await activateNextPack(state.profile.id); state.session = null; navigate('home'); }
  if (action === 'export-backup') await exportBackup();
  if (action === 'pick-backup') document.querySelector('#backup-input').click();
  if (action === 'reset-progress' && confirm(`确定重置“${state.profile.name}”的全部学习进度吗？词包会保留。`)) { await clearProfileProgress(state.profile.id); state.session = null; showToast('学习进度已重置'); await renderSettings(); }
});

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-self-result]'); if (button) await submitResult(button.dataset.selfResult);
});

app.addEventListener('input', (event) => {
  if (!event.target.matches('#paste-pack-name, #paste-words')) return;
  if (!state.pendingPasteImport) return;
  state.pendingPasteImport = null;
  const preview = document.querySelector('#paste-preview');
  if (preview) preview.innerHTML = '<p class="muted preview-stale">内容已修改，请重新“检查并预览”。</p>';
});

app.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter' || event.isComposing) return;
  const submit = document.querySelector('[data-action="submit-answer"]'); const next = document.querySelector('[data-action="next-question"]');
  if (submit) { event.preventDefault(); submit.click(); } else if (next) { event.preventDefault(); next.click(); }
});

window.addEventListener('hashchange', render);

async function init() {
  try {
    document.querySelector('.loading').textContent = '正在检查本地存储…';
    await openDatabase();
    document.querySelector('.loading').textContent = '正在准备两位小勇士的档案…';
    state.profiles = await ensureDefaultProfiles();
    await loadEnglishVoices();
    document.querySelector('.loading').textContent = '正在装入测试词库…';
    await seedTestVocabulary();
    const saved = localStorage.getItem('wordHeroActiveProfile'); if (saved) await loadProfile(saved);
    if (!location.hash) navigate(saved ? 'home' : 'profiles'); else await render();
  } catch (error) { app.innerHTML = `<main class="shell"><section class="card full"><h2>无法启动应用</h2><p>${escapeHtml(error.message)}</p><p class="muted">请确认没有使用隐私浏览模式，并允许此网站保存本地数据。</p></section></main>`; }
}

init();
