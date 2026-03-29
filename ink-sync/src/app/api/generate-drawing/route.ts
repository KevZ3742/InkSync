import { GoogleGenerativeAI } from '@google/generative-ai';

const MOCK_ELEMENTS = [
  {"id":"ai_0","type":"rect","x1":50,"y1":50,"x2":200,"y2":120,"color":"#1a1a2e","strokeWidth":2},
  {"id":"ai_1","type":"text","x1":65,"y1":92,"color":"#1a1a2e","strokeWidth":2,"text":"Start"},
  {"id":"ai_2","type":"arrow","x1":200,"y1":85,"x2":310,"y2":85,"color":"#1a1a2e","strokeWidth":2},
  {"id":"ai_3","type":"rect","x1":310,"y1":50,"x2":460,"y2":120,"color":"#6c63ff","strokeWidth":2},
  {"id":"ai_4","type":"text","x1":325,"y1":92,"color":"#6c63ff","strokeWidth":2,"text":"Process"},
  {"id":"ai_5","type":"arrow","x1":460,"y1":85,"x2":570,"y2":85,"color":"#1a1a2e","strokeWidth":2},
  {"id":"ai_6","type":"ellipse","x1":570,"y1":50,"x2":700,"y2":120,"color":"#FF6B6B","strokeWidth":2},
  {"id":"ai_7","type":"text","x1":600,"y1":92,"color":"#FF6B6B","strokeWidth":2,"text":"End"}
]

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const SYSTEM_PROMPT = `You are a drawing assistant for a collaborative whiteboard app. Given a text description, you generate drawing elements as a JSON array.

Each element must conform to exactly one of these TypeScript types:

type ElementType = 'pen' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text';

interface DrawElement {
  id: string;           // unique, e.g. "ai_0", "ai_1", etc.
  type: ElementType;
  x1: number;
  y1: number;
  x2?: number;          // required for line, arrow, rect, ellipse
  y2?: number;          // required for line, arrow, rect, ellipse
  points?: { x: number; y: number }[];  // only for pen strokes
  color: string;        // hex color
  strokeWidth: number;  // 1–8
  text?: string;        // only for text elements
  opacity?: number;     // 0–1, default 1
}

RULES:
- Return ONLY a raw JSON array. No markdown, no code fences, no explanation, no preamble.
- Output elements one per line to enable streaming. The full response must be a valid JSON array.
- Anchor all elements near the provided origin (originX, originY). Keep everything within ~500x400px of that origin.
- Use appropriate colors that make the drawing look good. Default to dark colors unless a color is specified.
- Use strokeWidth 2–4 for most elements, thicker (5–8) only for emphasis.
- For diagrams, use rect/ellipse for boxes, arrow for connections, text for labels.
- For illustrations, combine pen strokes, shapes, and text creatively.
- Make drawings detailed enough to be recognizable but not overly complex (8–25 elements is ideal).
- Text elements: x1/y1 is the text baseline start position.
- Rect/ellipse: x1/y1 is top-left, x2/y2 is bottom-right.
- Arrow/line: x1/y1 is start, x2/y2 is end.
- NEVER include any text outside the JSON array.`;

export async function POST(req: Request) {
  // Mock mode — set MOCK_AI=true in .env.local to skip API calls during development
  if (process.env.MOCK_AI === 'true') {
    const { originX = 100, originY = 100 } = await req.json().catch(() => ({}));
    const offset = (el: Record<string, unknown>) => {
      const e = { ...el };
      if (typeof e.x1 === 'number') e.x1 = (e.x1 as number) + originX;
      if (typeof e.y1 === 'number') e.y1 = (e.y1 as number) + originY;
      if (typeof e.x2 === 'number') e.x2 = (e.x2 as number) + originX;
      if (typeof e.y2 === 'number') e.y2 = (e.y2 as number) + originY;
      return e;
    };
    const elements = MOCK_ELEMENTS.map(offset);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (const el of elements) {
          controller.enqueue(encoder.encode(JSON.stringify(el) + '\n'));
          await new Promise(r => setTimeout(r, 80));
        }
        controller.close();
      }
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const { prompt, originX, originY } = await req.json();

  if (!prompt?.trim()) {
    return new Response('Missing prompt', { status: 400 });
  }

  const userMessage = `Draw: "${prompt}"
Origin point: (${Math.round(originX)}, ${Math.round(originY)})
Anchor all elements near this origin. Return only the JSON array.`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const model = genAI.getGenerativeModel({
          model: 'gemini-2.0-flash',
          systemInstruction: SYSTEM_PROMPT,
        });

        const result = await model.generateContentStream(userMessage);

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            controller.enqueue(encoder.encode(text));
          }
        }

        controller.close();
      } catch (err) {
        console.error('Generate drawing error:', err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  });
}