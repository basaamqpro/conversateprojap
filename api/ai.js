const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-6-luna";

const DIRECTIONS = new Set(["en-ja", "ja-en"]);
const SPEAKERS = new Set(["user", "partner"]);

const segmentSchema = {
  type: "object",
  properties: {
    english: { type: "string" },
    japanese: { type: "string" },
    transliteration: { type: "string" }
  },
  required: ["english", "japanese", "transliteration"],
  additionalProperties: false
};

const linguisticProperties = {
  english: { type: "string" },
  japanese: { type: "string" },
  segments: {
    type: "array",
    items: segmentSchema
  }
};

const TASKS = {
  process_sentence: {
    schemaName: "conversate_japanese_process_sentence",
    schema: {
      type: "object",
      properties: {
        valid: { type: "boolean" },
        message: { type: "string" },
        inputKind: {
          type: "string",
          enum: [
            "english",
            "japanese",
            "transliteration",
            "mixed",
            "unknown"
          ]
        },
        ...linguisticProperties
      },
      required: [
        "valid",
        "message",
        "inputKind",
        "english",
        "japanese",
        "segments"
      ],
      additionalProperties: false
    }
  },

  next_turn: {
    schemaName: "conversate_japanese_next_turn",
    schema: {
      type: "object",
      properties: {
        speaker: {
          type: "string",
          enum: ["user", "partner"]
        },
        ...linguisticProperties
      },
      required: ["speaker", "english", "japanese", "segments"],
      additionalProperties: false
    }
  },

  generate_options: {
    schemaName: "conversate_japanese_options",
    schema: {
      type: "object",
      properties: {
        options: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            properties: linguisticProperties,
            required: ["english", "japanese", "segments"],
            additionalProperties: false
          }
        }
      },
      required: ["options"],
      additionalProperties: false
    }
  },

  build_paragraph: {
    schemaName: "conversate_japanese_paragraph",
    schema: {
      type: "object",
      properties: linguisticProperties,
      required: ["english", "japanese", "segments"],
      additionalProperties: false
    }
  },

  teach: {
    schemaName: "conversate_japanese_teach",
    schema: {
      type: "object",
      properties: {
        explanation: { type: "string" }
      },
      required: ["explanation"],
      additionalProperties: false
    }
  }
};

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function jsonError(res, status, message, details) {
  return res.status(status).json({
    success: false,
    error: message,
    ...(details ? { details } : {})
  });
}

function validDirection(direction) {
  return DIRECTIONS.has(direction);
}

function nextSpeakerFromHistory(history) {
  const last = history[history.length - 1];

  if (!last) {
    return "partner";
  }

  return last.speaker === "user" ? "partner" : "user";
}

function normalizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  return rawHistory
    .slice(-40)
    .map((item) => ({
      speaker: SPEAKERS.has(item?.speaker) ? item.speaker : "user",
      english: cleanText(item?.english),
      japanese: cleanText(item?.japanese)
    }))
    .filter((item) => item.english || item.japanese);
}

function validateRequest(task, data) {
  if (!TASKS[task]) {
    return "Unsupported AI task.";
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "A data object is required.";
  }

  if (!validDirection(data.direction)) {
    return "direction must be either 'en-ja' or 'ja-en'.";
  }

  if (task === "process_sentence") {
    const text = cleanText(data.text);
    if (!text) return "Sentence text is required.";
    if (text.length > 1000) return "Sentence text is too long.";
  }

  if (task === "next_turn") {
    const history = normalizeHistory(data.history);
    if (history.length > 40) return "Conversation history is too long.";
  }

  if (task === "generate_options") {
    const sentence = data.sentence;
    if (!sentence || typeof sentence !== "object") {
      return "A source sentence is required.";
    }
    if (!cleanText(sentence.english) || !cleanText(sentence.japanese)) {
      return "The source sentence must contain English and Japanese.";
    }
  }

  if (task === "build_paragraph") {
    if (!Array.isArray(data.sentences) || data.sentences.length < 2) {
      return "At least two sentences are required to build a paragraph.";
    }
    if (data.sentences.length > 20) {
      return "A paragraph can contain at most 20 sentences for now.";
    }
  }

  if (task === "teach") {
    const item = data.item;
    if (!item || typeof item !== "object") {
      return "A sentence or option is required for Teach.";
    }
    if (!cleanText(item.english) || !cleanText(item.japanese)) {
      return "Teach requires both English and Japanese text.";
    }
  }

  return "";
}

function directionText(direction) {
  return direction === "en-ja"
    ? "The learning direction is English to Japanese. Japanese is the target/practice language."
    : "The learning direction is Japanese to English. English is the target/practice language.";
}

function commonJapaneseRules() {
  return [
    "Use clear, natural modern standard Japanese suitable for everyday communication.",
    "Preserve the intended meaning, person, tense, polarity, question/statement type, politeness level, and important details.",
    "When generating a new sentence without a clear register from context, prefer natural beginner-friendly polite Japanese rather than stiff textbook Japanese or very casual slang.",
    "Always return both a natural English sentence and its natural Japanese equivalent.",
    "Use normal Japanese orthography with appropriate kanji and kana. Do not convert everything to hiragana and do not insert spaces into the full Japanese sentence.",
    "For every breakdown segment, provide aligned English, Japanese, and Latin-script romaji transliteration.",
    "Use readable Hepburn-style romaji. Represent long vowels clearly when practical, for example gakkō and Tōkyō. For grammatical particles, transliterate pronunciation rather than spelling: は as wa when it is the topic particle, へ as e when it is the direction particle, and を as o.",
    "SEGMENTATION PRIORITY: make the breakdown fine-grained and Japanese-aligned. Separate important grammatical particles from the words they follow whenever that helps the learner understand the sentence.",
    "Default examples: 私 -> I -> watashi; は -> topic marker -> wa; 学校 -> school -> gakkō; に -> to/at -> ni; 行きました -> went -> ikimashita.",
    "Keep ordinary lexical units such as nouns, pronouns, adverbs, counters, and inflected verbs/adjectives as useful learning units rather than splitting individual kanji characters.",
    "Keep a normal conjugated verb such as 行きました or 食べました together by default. Separate auxiliaries or grammatical pieces only when doing so is clearly more useful and still natural for the learner.",
    "Separate particles such as は, が, を, に, で, へ, と, も, から, まで, の when they function independently in the sentence.",
    "For each Japanese unit, give the smallest natural English gloss that represents that unit's contribution in this sentence. A grammatical particle may use a teaching gloss such as 'topic marker', 'object marker', 'at/in', or 'to'.",
    "Do not force a false one-to-one translation. English may require several words for one Japanese unit, and a Japanese grammatical item may have no direct English word.",
    "Only combine multiple Japanese units into one segment when separating them would be misleading or would destroy a fixed expression.",
    "Do NOT collapse an ordinary sentence into two or three broad phrase segments when it can be represented accurately with more useful word/particle-level segments.",
    "The transliteration must represent the Japanese segment, not the English text.",
    "Do not add explanations outside the requested JSON structure."
  ].join("\n");
}

function buildPrompt(task, data) {
  const direction = data.direction;
  const directionInstruction = directionText(direction);

  if (task === "process_sentence") {
    return {
      system: [
        "You are the sentence-normalization engine for ConversateProJapanese, an English-Japanese language-learning application.",
        directionInstruction,
        commonJapaneseRules(),
        "The learner may type English, Japanese script (kanji/kana), romaji, approximate phonetic spelling such as 'watashi wa gakko ni ikimashita', or a reasonable mixture of English and Japanese/romaji.",
        "Infer the intended sentence conservatively. Correct obvious romaji or spelling noise without changing the intended meaning.",
        "The application teaches one sentence at a time. If the input clearly contains more than one independent sentence, set valid=false, give a short message asking for one sentence at a time, and return empty English/Japanese strings with an empty segments array.",
        "If it is one sentence, set valid=true and message to an empty string.",
        "Classify inputKind as english, japanese, transliteration, mixed, or unknown.",
        "For valid input, produce a detailed Japanese word/particle-aligned breakdown rather than a small number of broad phrase groups."
      ].join("\n\n"),
      user: JSON.stringify({
        direction,
        text: cleanText(data.text)
      })
    };
  }

  if (task === "next_turn") {
    const history = normalizeHistory(data.history);
    const requiredSpeaker = nextSpeakerFromHistory(history);

    return {
      system: [
        "You generate exactly one next conversational turn for ConversateProJapanese.",
        directionInstruction,
        commonJapaneseRules(),
        `The next speaker MUST be '${requiredSpeaker}'.`,
        "Generate exactly one natural sentence that continues the supplied conversation coherently.",
        "Do not generate both sides of the conversation and do not add narration.",
        "Keep the sentence useful for a beginner or intermediate language learner unless the existing conversation clearly requires more advanced wording.",
        "Return speaker exactly as required.",
        "Break the generated sentence down at useful Japanese word/particle level wherever linguistically sensible."
      ].join("\n\n"),
      user: JSON.stringify({
        direction,
        requiredSpeaker,
        history
      })
    };
  }

  if (task === "generate_options") {
    const sentence = {
      english: cleanText(data.sentence?.english),
      japanese: cleanText(data.sentence?.japanese)
    };

    return {
      system: [
        "You generate sentence variations for ConversateProJapanese.",
        directionInstruction,
        commonJapaneseRules(),
        "Create exactly three useful alternatives related to the supplied sentence.",
        "The alternatives should help the learner vary vocabulary, place, object, time, adjective, verb, politeness, or another natural element while keeping the grammatical pattern reasonably learnable.",
        "Do not merely paraphrase all three in almost identical wording.",
        "Each option must be a complete standalone sentence and must preserve a sensible relation to the original sentence.",
        "Give every option the same fine-grained Japanese word/particle-aligned breakdown required for normal sentences."
      ].join("\n\n"),
      user: JSON.stringify({
        direction,
        sentence
      })
    };
  }

  if (task === "build_paragraph") {
    const sentences = data.sentences.map((sentence, index) => ({
      order: Number.isFinite(Number(sentence?.order))
        ? Number(sentence.order)
        : index,
      english: cleanText(sentence?.english),
      japanese: cleanText(sentence?.japanese)
    }));

    return {
      system: [
        "You build a short connected passage for ConversateProJapanese from selected sentence meanings.",
        directionInstruction,
        commonJapaneseRules(),
        "Use ALL supplied sentences exactly once in their supplied order.",
        "Translate/rewrite the full selected content as one coherent passage; do not concatenate previously translated fragments mechanically.",
        "You may add only minimal grammatical connectors that are necessary for natural flow.",
        "Do not invent new facts, events, opinions, people, places, or actions.",
        "Preserve perspective, tense, negation, questions, and politeness where possible.",
        "Return a fresh paragraph-wide breakdown covering the complete passage.",
        "Even for a paragraph, keep the segments fine-grained and Japanese word/particle-aligned; do not turn each sentence into one large segment."
      ].join("\n\n"),
      user: JSON.stringify({
        direction,
        sentences
      })
    };
  }

  if (task === "teach") {
    const item = {
      english: cleanText(data.item?.english),
      japanese: cleanText(data.item?.japanese),
      segments: Array.isArray(data.item?.segments)
        ? data.item.segments
        : []
    };

    return {
      system: [
        "You are the Teach feature for ConversateProJapanese.",
        directionInstruction,
        "Explain the supplied English-Japanese sentence pair to an English-speaking learner clearly and concisely.",
        "Focus on the most useful points: natural meaning, important vocabulary, kanji readings when helpful, romaji pronunciation, particles, word order, verb/adjective conjugation, politeness/register, counters, pronouns/omission, and literal versus natural meaning.",
        "When useful, mention whether a particle is pronounced differently from its spelling, such as は pronounced wa, へ pronounced e, or を pronounced o.",
        "Do not overwhelm the learner. Prefer a compact explanation of the most relevant features of this specific sentence.",
        "When the learning direction is Japanese to English, still explain important Japanese structure when it helps explain the English meaning.",
        "Do not claim a rule that is not illustrated by the supplied sentence."
      ].join("\n\n"),
      user: JSON.stringify({
        direction,
        item
      })
    };
  }

  throw new Error("Unsupported AI task.");
}

function extractOutputText(responseData) {
  if (typeof responseData?.output_text === "string") {
    return responseData.output_text.trim();
  }

  const pieces = [];

  for (const item of responseData?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        pieces.push(content.text);
      }

      if (content?.type === "refusal" && typeof content.refusal === "string") {
        throw new Error(content.refusal);
      }
    }
  }

  return pieces.join("\n").trim();
}

async function callOpenAI(task, data, apiKey) {
  const taskConfig = TASKS[task];
  const prompt = buildPrompt(task, data);

  const openAIResponse = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
      input: [
        {
          role: "system",
          content: prompt.system
        },
        {
          role: "user",
          content: prompt.user
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: taskConfig.schemaName,
          strict: true,
          schema: taskConfig.schema
        }
      }
    })
  });

  let responseData;

  try {
    responseData = await openAIResponse.json();
  } catch (error) {
    throw new Error("OpenAI returned an invalid response.");
  }

  if (!openAIResponse.ok) {
    const message =
      responseData?.error?.message ||
      "OpenAI request failed.";

    const error = new Error(message);
    error.status = openAIResponse.status;
    throw error;
  }

  const outputText = extractOutputText(responseData);

  if (!outputText) {
    throw new Error("OpenAI returned no structured output.");
  }

  try {
    return JSON.parse(outputText);
  } catch (error) {
    throw new Error("OpenAI returned malformed structured output.");
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return jsonError(res, 405, "Method not allowed. Use POST.");
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return jsonError(
      res,
      500,
      "OPENAI_API_KEY is not configured."
    );
  }

  const task = cleanText(req.body?.task);
  const data = req.body?.data;
  const validationError = validateRequest(task, data);

  if (validationError) {
    return jsonError(res, 400, validationError);
  }

  try {
    const result = await callOpenAI(task, data, apiKey);

    return res.status(200).json({
      success: true,
      task,
      result
    });
  } catch (error) {
    console.error("ConversateProJapanese AI error:", error);

    return jsonError(
      res,
      Number(error?.status) || 500,
      error?.message || "AI request failed."
    );
  }
}
