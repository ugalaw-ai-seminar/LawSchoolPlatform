// RES prompt library, ported from the LOQUITUR web app.
// Each builder returns { system, prompt, task } so it can run either through
// a configured provider or be handed back to the host agent to execute itself.

const DIFF_LABELS = {
  early: 'early-semester comprehension level',
  mid: 'midterm reinforcement level',
  final: 'final exam complexity level',
};

// full and attack match the web app's Outline Builder instructions word for word
const OUTLINE_TYPES = {
  full: `Create a comprehensive law school outline: condense the entire semester's case law, statutes, binding precedent and class notes into one cohesive legal roadmap optimized for a timed final exam.
- Translate judicial opinions into actionable black-letter law statements, using the professor's own wording from the notes wherever it appears.
- Break every rule into its elements, then list the key exceptions, defenses and limits.
- For each doctrine, synthesize the major case illustrations (facts in one line, holding, why it matters) alongside any classroom hypotheticals and the underlying policy rationales.
- Organize by topic and subtopic in the order an exam answer would analyze them, so the outline doubles as an issue-spotting tool and an open-book exam index for building structured, high-scoring essay answers.
- Aim for active application, not passive archiving: after each major topic, add a short "How to use on the exam" note.`,
  attack: `Create an attack outline (checklist): a hyper-condensed, 1-to-5-page cheat sheet designed to be used live during a timed exam.
- Lead with a master issue checklist in the order issues should be spotted, then one compact section per issue.
- Each section: a step-by-step analysis checklist (numbered questions to ask), the rule or test in a single line, elements as short bullets, key exceptions, and the one or two cases or formulas worth citing.
- Show multi-step tests as text flowcharts using arrows (e.g. "Offer? → Acceptance? → Consideration? → Defenses?"), not diagrams or code blocks.
- No case narratives, no policy essays, no full sentences where a phrase will do. Keep the whole thing within about five pages.`,
  checklist: 'Create a one-page exam checklist with every issue to spot, organized by topic, with brief rule triggers.',
};

export function outline({ courseName, type = 'full', notes, materials }) {
  const instr = OUTLINE_TYPES[type] || OUTLINE_TYPES.full;
  const hasMaterials = materials && !materials.startsWith('No materials');
  const prompt = notes
    ? `For the course "${courseName}", ${instr}\n\nPRIMARY SOURCE (student's own notes):\n${notes.slice(0, 40000)}${hasMaterials ? `\n\nSUPPLEMENTAL COURSE MATERIALS:\n${materials}` : ''}`
    : `For the course "${courseName}", ${instr}\n\nBase this on the following materials:\n${materials}`;
  return {
    system: 'You are RES, an expert law school outline builder. Create clear, well-organized, accurate legal outlines that would help a student prepare for exams.',
    prompt,
    task: 'outline_full',
  };
}

export function quiz({ courseName, qtype = 'mbe', difficulty = 'mid', topic, materials, weak }) {
  let topicClause = topic ? ` focused specifically on the topic: "${topic}"` : '';
  if (!topic && weak?.length) {
    topicClause = ` with emphasis on the student's weak areas: ${weak.map(w => `"${w.topic}" (${w.avg}% avg)`).join(', ')}`;
  }
  const system = 'You are RES, an expert law school quiz generator. Create challenging, pedagogically sound questions that test understanding of legal doctrines, rules, and analytical skills.';
  const level = DIFF_LABELS[difficulty] || DIFF_LABELS.mid;

  if (qtype === 'mbe') {
    return {
      system,
      task: 'normal',
      prompt: `Generate 5 MBE-style multiple choice questions at ${level} for the course "${courseName}"${topicClause}.

Format each question EXACTLY like this, with no deviations:
QUESTION: [full question text, may include a fact pattern]
A: [option text]
B: [option text]
C: [option text]
D: [option text]
===

Do NOT include the correct answer or any explanation. The student will answer first.

Base questions on these materials:
${materials}`,
    };
  }
  const labels = {
    short: 'short answer questions',
    'issue-spot': 'issue spotter questions with complex fact patterns',
    hypo: 'a full exam hypothetical with multiple embedded issues',
  };
  const count = qtype === 'hypo' ? 1 : 3;
  return {
    system,
    task: qtype === 'hypo' ? 'hypo' : 'normal',
    prompt: `Generate ${count} ${labels[qtype]} at ${level} for the course "${courseName}"${topicClause}.

Format each question EXACTLY like this, with no deviations:
QUESTION: [full question text, may include a detailed fact pattern]
===

Do NOT include answers, rubrics, or explanations. The student will answer first.

Base questions on these materials:
${materials}`,
  };
}

export function gradeMBE(questions, answers) {
  const body = questions
    .map((q, i) => `Question ${i + 1}: ${q.question}\nStudent selected: (${answers[i]}) ${q.options?.[answers[i]] ?? ''}`)
    .join('\n\n');
  return {
    system: 'You are RES, an expert law professor. Grade MBE answers clearly and educationally. Use ## for each question heading.',
    task: 'normal',
    prompt: `A law student just completed a multiple choice quiz. Grade their answers.

For EACH question:
1. State whether they were CORRECT or INCORRECT
2. Reveal the correct answer and letter
3. Briefly explain the controlling rule and why the correct answer is right
4. If wrong, explain why their choice was incorrect

End with a line in exactly this form: "TOTAL: X out of ${questions.length}", then 1-2 sentences of overall feedback.

Student's answers:
${body}`,
  };
}

export function gradeText(questions, answers) {
  const body = questions
    .map((q, i) => `--- QUESTION ${i + 1} ---\n${q.question}\n\n--- STUDENT ANSWER ${i + 1} ---\n${answers[i]}`)
    .join('\n\n');
  return {
    system: 'You are RES, an expert law professor. Grade each answer rigorously but constructively. Always produce a rubric first, then score against it.',
    task: 'grade_text',
    prompt: `You are a law professor grading a student's written quiz. Grade EACH answer using a detailed rubric.

For EACH question, use "## Question N: [brief topic]" as the heading and provide:

### Rubric
4-5 specific grading criteria with point values totaling 10 (e.g. Issue Identification, Rule Statement, Application, Counter-arguments, Conclusion).

### Scoring
Points earned per criterion with a one-sentence note.

### Total Score
**X / 10**

### Feedback
2-3 sentences on strengths and the most important area to improve.

${body}`,
  };
}

export function studyTool({ kind, courseName, materials }) {
  const system = 'You are RES, an expert law school AI tutor. Be thorough, accurate, and pedagogically sound.';
  const map = {
    'practice-questions': {
      task: 'normal',
      prompt: `Based on the following course materials for "${courseName}", generate 3 practice questions: 1 MBE-style multiple choice, 1 short answer, and 1 issue spotter. Include answers and explanations.\n\nMaterials:\n${materials}`,
    },
    'cold-call': {
      task: 'cold_call',
      prompt: `You are a law professor teaching "${courseName}". Based on the following materials, generate a realistic cold-call simulation with 5 Socratic-method questions that build on each other. Include the "correct" direction of analysis for each.\n\nMaterials:\n${materials}`,
    },
    'exam-hypo': {
      task: 'exam_hypo',
      prompt: `Create a full-length, exam-quality hypothetical fact pattern for "${courseName}" that tests multiple doctrines from the materials below. After the fact pattern, provide a model answer outline identifying all issues, applicable rules, and analysis framework (IRAC).\n\nMaterials:\n${materials}`,
    },
  };
  return { system, ...map[kind] };
}

export function bluebook({ mode, sourceType, details, format = 'full', citation, topic, jurisdiction }) {
  if (mode === 'generate') {
    return {
      system: 'You are RES, an expert in Bluebook legal citation format. Produce accurate citations following The Bluebook: A Uniform System of Citation (21st ed.).',
      task: 'cite_gen',
      prompt: `Generate a proper Bluebook citation (${format} form) for this ${sourceType || 'source'}:\n${details}\n\nReturn ONLY the formatted citation, nothing else.`,
    };
  }
  if (mode === 'fix') {
    return {
      system: 'You are RES, an expert in Bluebook legal citation format (21st ed.).',
      task: 'cite_fix',
      prompt: `Fix this citation to proper Bluebook format:\n${citation}\n\nReturn the corrected citation, then on a new line explain what was changed.`,
    };
  }
  const jNote = jurisdiction ? ` Focus on ${jurisdiction} law.` : '';
  return {
    system: 'You are RES, an expert legal writer. Draft paragraphs with accurate Bluebook citations to real authorities. If you are not confident an authority exists, say so rather than inventing one.',
    task: 'draft_cite',
    prompt: `Draft a well-written legal paragraph about: ${topic}.${jNote}\n\nInclude proper Bluebook citations to real, verifiable cases and statutes. Use footnote-style citation placement.`,
  };
}

export function reorganizeNotes(text) {
  return {
    system: 'You are RES, an expert at organizing law school notes.',
    task: 'normal',
    prompt: `Reorganize and structure these law school class notes into a clear, well-organized format using markdown headings (##), sub-headings, and bullet points. Preserve every substantive point from the original notes; do not drop content, only restructure and clarify it.\n\n${text}`,
  };
}

export function diagram(text) {
  return {
    system: 'You are RES. You generate clean, syntactically valid Mermaid.js "graph TD" flowcharts that accurately reflect the structure of law school notes. Output raw mermaid syntax only, formatted exactly as instructed.',
    task: 'diagram',
    prompt: `Below are a law student's class notes. Turn them into one or more clear, well-organized Mermaid.js flowcharts (graph TD) that a student could study from.

Rules:
- Use the notes' own headings and sub-points to drive the structure. Do not invent generic placeholder nodes.
- Main topic at the top, major doctrines as branches, sub-rules, exceptions, elements, or case names as children.
- Every node label is short (under 8 words), specific, and in double quotes, e.g. A["Offer must be definite"].
- Use plain alphanumeric node IDs (A, B, C1, C2...).
- Aim for 8-15 nodes per diagram unless the notes are very short.
- If the notes cover several distinct major topics, output one diagram per topic.
- Format EVERY diagram exactly like this:
## <Short Topic Title>
graph TD
  A["..."] --> B["..."]
- Return ONLY the heading(s) and mermaid code. No prose and no code fences.

Notes:
${text}`,
  };
}

export function studyPlan(courses) {
  return {
    system: 'You are RES, a law school study planning assistant. Create practical, time-blocked study plans that incorporate spaced repetition and prevent burnout.',
    task: 'normal',
    prompt: `Create a detailed weekly study plan based on these courses, class meeting times, and upcoming assignments:\n\n${JSON.stringify(courses, null, 2)}\n\nToday is ${new Date().toDateString()}. Work around scheduled class times, include spaced repetition and breaks, and prioritize upcoming deadlines.`,
  };
}

// ── Parsers ──

export function parseMBE(text) {
  return text
    .split('===')
    .map(block => {
      block = block.trim();
      const q = block.match(/QUESTION:\s*([\s\S]+?)(?=\nA:)/i);
      const opts = ['A', 'B', 'C', 'D'].map(l => block.match(new RegExp(`^${l}:\\s*(.+)`, 'm')));
      if (!q || opts.some(o => !o)) return null;
      return { question: q[1].trim(), options: Object.fromEntries(opts.map((o, i) => ['ABCD'[i], o[1].trim()])) };
    })
    .filter(Boolean);
}

export function parseText(text) {
  return text
    .split('===')
    .map(b => b.trim().match(/QUESTION:\s*([\s\S]+)/i))
    .filter(Boolean)
    .map(m => ({ question: m[1].trim() }));
}

export function parseDiagrams(raw) {
  const cleaned = raw.replace(/```mermaid\n?/g, '').replace(/```\n?/g, '');
  const parts = cleaned.split(/^##\s+(.+)$/m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) {
    const code = (parts[i + 1] || '').trim();
    if (code) out.push({ title: parts[i].trim(), code });
  }
  if (!out.length && cleaned.trim()) out.push({ title: 'Diagram', code: cleaned.trim() });
  return out;
}

/** Returns a 0-100 score, or null if no score could be found. */
export function extractScore(text, qtype, count) {
  if (qtype === 'mbe') {
    const m = text.match(/TOTAL:\s*(\d+)\s*(?:out of|\/)\s*(\d+)/i) || text.match(/(\d+)\s*(?:out of|\/)\s*(\d+)/i);
    if (m) return Math.round((Number(m[1]) / Number(m[2] || count)) * 100);
    return null;
  }
  const scores = [...text.matchAll(/(\d+(?:\.\d+)?)\s*\/\s*10\b/g)].map(m => Number(m[1]));
  if (!scores.length) return null;
  const relevant = scores.slice(-count); // the per-question totals come after rubric lines
  return Math.round((relevant.reduce((a, b) => a + b, 0) / (relevant.length * 10)) * 100);
}
