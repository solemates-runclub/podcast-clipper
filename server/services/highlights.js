// Local, deterministic highlight scoring — no external API calls.
// Whisper + VAD already splits speech into natural pause-bounded segments, so we snap
// candidate window boundaries exactly to segment edges rather than doing our own
// sentence splitting: that alone avoids ever cutting mid-sentence.

const TRIGGER_PHRASES = [
  'never', 'always', 'biggest mistake', 'the truth is', 'nobody tells you',
  'secret', 'worst', 'best', 'actually', "here's the thing", 'turns out',
  'shocking', 'insane', 'crazy', 'wild', 'no one talks about', 'underrated',
  'overrated', 'mistake', 'wrong', 'lied', 'lie', 'truth', 'reality',
  'hate', 'love', 'hardest', 'easiest', 'nobody', 'everyone', 'stop',
  'why', 'how i', 'i realized', 'changed my life', 'ruined',
];

function scoreText(text) {
  const lower = text.toLowerCase();
  let score = 0;
  score += (text.match(/\?/g) || []).length * 3;
  score += (text.match(/!/g) || []).length * 2;
  for (const phrase of TRIGGER_PHRASES) {
    if (lower.includes(phrase)) score += 4;
  }
  // Distinct numbers only -- a stutter like "4, 4, 4" or "10, 10AM, 10AM" shouldn't
  // out-score a window that mentions several different real figures.
  const numbers = new Set(text.match(/\b\d+\b/g) || []);
  score += Math.min(numbers.size * 2, 6);
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  score += Math.min(wordCount / 10, 5);
  return score;
}

// Whisper occasionally stutters through a low-confidence stretch of audio, repeating
// short phrases with minor variation ("it's weird. it's weird. it's weird how much.")
// rather than looping one exact phrase -- too irregular for isRepetitiveGarbage's exact
// n-gram match. Lexical diversity (unique words / total words) catches this class too:
// real speech covering new ground stays well above ~0.55 even over a full clip; a
// stutter collapses toward the number of distinct words in the one phrase being repeated.
function lexicalDiversity(text) {
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  if (words.length < 12) return 1; // too short a sample to judge fairly
  return new Set(words).size / words.length;
}

const MIN_QUESTION_WORDS = 4;

function isQuestion(text) {
  return text.includes('?');
}

// Joining adjacent transcript segments with a plain space occasionally produces a
// doubled-up punctuation artifact right at the seam (e.g. "...forward, , is there...")
// when whisper put trailing/leading punctuation on both sides of a segment break.
function joinSegmentTexts(texts) {
  return texts
    .map((t) => t.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/([,.!?;:])\s*\1/g, '$1')
    .replace(/,\s*([.!?])/g, '$1')
    .trim();
}

function endsSentence(text) {
  return /[.!?]['")]?\s*$/.test(text.trim());
}

// Whisper hallucination sometimes loops a short phrase dozens of times over an
// uncertain stretch of audio ("It makes. It makes. It makes...") -- these can score
// deceptively high (lots of "words") despite being garbage. Detect it by checking
// whether any 3-word run repeats an unreasonable number of times.
function isRepetitiveGarbage(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length < 9) return false;
  // Check 2-, 3-, and 4-word phrases: a stutter often varies word-by-word ("it's weird.
  // it's weird. it's weird how much.") so the repeated unit isn't always a clean,
  // unbroken trigram -- the shorter windows catch those too. An exact 4-word phrase
  // repeat is rare enough in real speech that even two occurrences is a reliable tell
  // (e.g. "you can think about this for you can think about this for you").
  for (const [n, threshold] of [[4, 2], [3, 4], [2, 5]]) {
    if (words.length < n) continue;
    const counts = new Map();
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n).join(' ');
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
    if (Math.max(...counts.values()) >= threshold) return true;
  }
  return false;
}

// Fallback for content without clear Q&A structure (monologue-style podcasts): plain
// duration windows snapped to segment boundaries, scored by keyword heuristics.
function buildCandidateWindows(segments, { minLen, maxLen }) {
  const windows = [];
  for (let i = 0; i < segments.length; i++) {
    const start = segments[i].start;
    let end = start;
    let spokenDuration = 0;
    const slice = [];
    for (let j = i; j < segments.length; j++) {
      const seg = segments[j];
      const dur = seg.end - start;
      if (dur > maxLen) break;
      slice.push(seg);
      end = seg.end;
      spokenDuration += seg.end - seg.start;
      if (dur >= minLen) {
        const text = joinSegmentTexts(slice.map((s) => s.text));
        if (!isRepetitiveGarbage(text)) {
          windows.push({ start, end, text, segments: slice.slice(), spokenDuration, isQa: false });
        }
      }
    }
  }
  return windows;
}

// The main strategy: a clip should be a complete question -> full answer exchange, not
// an arbitrary duration-sliced fragment. Every segment containing '?' is a candidate
// question start; the window absorbs any immediately-following question segments (a
// multi-part question), then captures everything after as "the answer" until either the
// NEXT question begins or the duration cap is hit. Windows shorter than minLen (too
// thin an exchange to stand alone) are dropped.
function buildQaWindows(segments, { minLen, maxLen }) {
  const windows = [];

  for (let qi = 0; qi < segments.length; qi++) {
    if (!isQuestion(segments[qi].text)) continue;

    // A question can be split across several transcript segments (whisper's segment
    // breaks don't respect sentence boundaries). If the segment with the '?' doesn't
    // itself start a fresh sentence, walk back to whichever segment does, so the clip
    // starts at the actual beginning of the question instead of mid-sentence.
    let qStart = qi;
    let backSteps = 0;
    while (qStart > 0 && !endsSentence(segments[qStart - 1].text) && backSteps < 4) {
      qStart--;
      backSteps++;
    }

    const start = segments[qStart].start;
    let j = qi;
    while (
      j + 1 < segments.length &&
      isQuestion(segments[j + 1].text) &&
      segments[j + 1].start - start < maxLen
    ) {
      j++;
    }
    const questionText = joinSegmentTexts(segments.slice(qStart, j + 1).map((s) => s.text));

    // A bare tag question ("Right?", "He bet, right?", "Contributing to others?") is a
    // backchannel filler, not a real question worth building a clip around -- skip it so
    // a genuinely substantive nearby question can anchor this stretch instead.
    if (questionText.split(/\s+/).filter(Boolean).length < MIN_QUESTION_WORDS) continue;

    const slice = segments.slice(qStart, j + 1);
    let end = segments[j].end;
    let spokenDuration = slice.reduce((sum, s) => sum + (s.end - s.start), 0);

    let k = j + 1;
    while (k < segments.length) {
      if (isQuestion(segments[k].text)) break; // the next question starts -- this answer is done
      const dur = segments[k].end - start;
      if (dur > maxLen) break;
      slice.push(segments[k]);
      end = segments[k].end;
      spokenDuration += segments[k].end - segments[k].start;
      k++;
    }

    const duration = end - start;
    if (duration < minLen) continue;

    const text = joinSegmentTexts(slice.map((s) => s.text));
    if (isRepetitiveGarbage(text)) continue;
    windows.push({ start, end, text, segments: slice, spokenDuration, isQa: true, questionText });
  }

  return windows;
}

function scoreWindow(win, targetLen) {
  const duration = win.end - win.start;
  const density = win.spokenDuration / duration;
  let score = scoreText(win.text);
  score += density * 4; // reward windows without long silences
  score -= Math.abs(duration - targetLen) * 0.05;

  const diversity = lexicalDiversity(win.text);
  if (diversity < 0.55) score -= (0.55 - diversity) * 60; // stutter/repetition penalty

  if (win.isQa) {
    const questionWords = win.questionText.split(/\s+/).filter(Boolean).length;
    score += Math.min(questionWords / 3, 4); // reward a fuller, more substantive question
  }

  return score;
}

function overlaps(a, b) {
  return a.start < b.end && a.end > b.start;
}

function truncateChars(text, maxChars) {
  const trimmed = text.trim();
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars - 1).trim() + '…' : trimmed;
}

// Full (untruncated) best-scoring sentence in a window -- used as the topic line for
// windows that aren't a detected question (monologue-style fallback windows).
function pickTopicSentence(segments) {
  let best = segments[0];
  let bestScore = -Infinity;
  for (const seg of segments) {
    const s = scoreText(seg.text);
    if (s > bestScore) {
      bestScore = s;
      best = seg;
    }
  }
  return truncateChars(best.text, 220);
}

const MIN_HOOK_WORDS = 7;
const MAX_HOOK_WORDS = 9;

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Cuts to the first N words (not characters) so hooks stay genuinely short headlines
// rather than truncated sentences. Drops a dangling comma/semicolon left by the cut.
function truncateWords(text, maxWords) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(' ').replace(/[,;:]+$/, '');
}

// Finds the best-scoring segment within [rangeStart,rangeEnd], then pads it out with
// whatever follows (and, if still short, precedes) it -- reaching outside the clip's
// own range into the rest of the transcript if that's what it takes -- so there's
// enough material for a MIN_HOOK_WORDS-9 word hook even when the clip's own window is
// too sparse on its own (e.g. one long, mostly-silent VAD segment).
function buildHookSource(allSegments, rangeStart, rangeEnd) {
  const inRangeIdx = [];
  allSegments.forEach((seg, i) => {
    if (seg.end > rangeStart && seg.start < rangeEnd) inRangeIdx.push(i);
  });
  const candidateIdx = inRangeIdx.length ? inRangeIdx : allSegments.map((_, i) => i);

  let bestIdx = candidateIdx[0];
  let bestScore = -Infinity;
  for (const i of candidateIdx) {
    const s = scoreText(allSegments[i].text);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }

  const parts = [allSegments[bestIdx].text.trim()];
  let after = bestIdx + 1;
  let before = bestIdx - 1;
  while (wordCount(parts.join(' ')) < MIN_HOOK_WORDS && (after < allSegments.length || before >= 0)) {
    if (after < allSegments.length) {
      parts.push(allSegments[after].text.trim());
      after++;
    }
    if (wordCount(parts.join(' ')) >= MIN_HOOK_WORDS) break;
    if (before >= 0) {
      parts.unshift(allSegments[before].text.trim());
      before--;
    }
  }
  return joinSegmentTexts(parts);
}

// allSegments is the full transcript so padding can reach just outside the clip's own
// range when that range alone is too sparse; [rangeStart,rangeEnd] scopes which
// segment is picked as the "best" one to build the hook around.
function draftHooks(allSegments, rangeStart, rangeEnd) {
  const source = buildHookSource(allSegments, rangeStart, rangeEnd);
  const trimmed = source
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/["]/g, '')
    .replace(/^[,;:.\s]+/, ''); // a mid-sentence-joined fragment can start with stray punctuation
  const lower = trimmed.toLowerCase();
  const options = [];

  const lead = capitalize(truncateWords(trimmed, MAX_HOOK_WORDS));
  if (lead) options.push(lead);

  const foundTrigger = TRIGGER_PHRASES.find((p) => lower.includes(p));
  if (foundTrigger) {
    const idx = lower.indexOf(foundTrigger);
    const fromTrigger = capitalize(truncateWords(trimmed.slice(idx), MAX_HOOK_WORDS));
    if (fromTrigger && fromTrigger.toLowerCase() !== lead.toLowerCase()) {
      options.push(fromTrigger);
    }
  }

  if (trimmed.includes('?')) {
    const q = `${capitalize(truncateWords(trimmed.split('?')[0], MAX_HOOK_WORDS))}?`;
    if (!options.some((o) => o.toLowerCase() === q.toLowerCase())) options.push(q);
  } else if (lead) {
    const quoted = `"${lead}"`;
    if (!options.some((o) => o.toLowerCase() === quoted.toLowerCase())) options.push(quoted);
  }

  return options.slice(0, 3);
}

// Returns exactly `count` (or as many as the transcript allows) non-overlapping
// highlight windows near `targetLen` seconds long, each with a transcript snippet,
// a topic/question label, and drafted hook options. Complete question->answer
// exchanges are always preferred; plain duration windows only fill in remaining slots
// when the video doesn't have enough (or any) detected Q&A structure to work with.
function generateHighlights(transcript, { count, targetLen }) {
  const segments = transcript.segments || [];
  if (segments.length === 0 || !count || !targetLen) return [];

  const minLen = Math.max(5, targetLen * 0.75);
  const maxLen = targetLen * 1.25;

  const qaWindows = buildQaWindows(segments, { minLen, maxLen });
  for (const w of qaWindows) w.score = scoreWindow(w, targetLen);
  qaWindows.sort((a, b) => b.score - a.score);

  const selected = [];
  for (const w of qaWindows) {
    if (selected.length >= count) break;
    if (selected.some((s) => overlaps(s, w))) continue;
    selected.push(w);
  }

  if (selected.length < count) {
    const genericWindows = buildCandidateWindows(segments, { minLen, maxLen });
    for (const w of genericWindows) w.score = scoreWindow(w, targetLen);
    genericWindows.sort((a, b) => b.score - a.score);
    for (const w of genericWindows) {
      if (selected.length >= count) break;
      if (selected.some((s) => overlaps(s, w))) continue;
      selected.push(w);
    }
  }

  selected.sort((a, b) => a.start - b.start);

  return selected.map((w) => ({
    start: w.start,
    end: w.end,
    score: w.score,
    transcriptSnippet: w.text,
    topicText: w.isQa ? truncateChars(w.questionText, 220) : pickTopicSentence(w.segments),
    hookOptions: draftHooks(segments, w.start, w.end),
  }));
}

// Re-derives a snippet + topic + hook options for an arbitrary (e.g. manually-edited)
// range.
function describeRange(transcript, start, end) {
  const allSegments = transcript.segments || [];
  const segments = allSegments.filter((seg) => seg.end > start && seg.start < end);
  if (segments.length === 0) {
    return { transcriptSnippet: '', hookOptions: [], topicText: '' };
  }
  const text = joinSegmentTexts(segments.map((s) => s.text));
  const questionSeg = segments.find((s) => isQuestion(s.text));
  const topicText = questionSeg ? truncateChars(questionSeg.text, 220) : pickTopicSentence(segments);
  return { transcriptSnippet: text, hookOptions: draftHooks(allSegments, start, end), topicText };
}

module.exports = { generateHighlights, describeRange, scoreText };
