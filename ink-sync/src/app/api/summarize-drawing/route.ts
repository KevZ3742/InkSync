import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const SYSTEM_PROMPT = `You are analyzing a whiteboard drawing described as structured data. The drawing may contain a mix of geometric shapes, arrows, lines, text labels, and freehand pen strokes.

IMPORTANT: Freehand pen strokes (type "pen") are described by their bounding box, start point, end point, and point count — NOT as raw coordinates. Interpret them based on:
- Their shape: if roughly square bounding box and many points → likely a circle or scribble
- Their position relative to other elements: near a box → likely an annotation or underline
- Their start/end points: if close together → likely a closed shape; if far apart → likely a line or arrow
- Their size relative to the canvas: large pen stroke covering most of the drawing → likely a background annotation or enclosure
- Always try to infer meaning from context rather than treating pen strokes as meaningless scribbles

Respond with ONLY a raw JSON object (no markdown, no code fences) with exactly these fields:
{
  "title": "3-5 word title describing the drawing",
  "description": "1-2 sentence plain English description of what is drawn and its purpose",
  "points": ["key point 1", "key point 2", ...]
}

RULES:
- title: short, specific, capitalize like a title
- description: explain what it is and what it shows as if describing to someone who can't see it
- points: 2-5 bullet strings, each a concise observation about structure, content, or meaning
- Reference text labels specifically when present
- Be concrete ("A 3-step login flowchart" not "A diagram")
- Treat pen strokes as intentional marks — infer their likely meaning from context
- NEVER include anything outside the JSON object`;

interface RawElement {
  id: string;
  type: string;
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
  points?: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
  text?: string;
}

// Condense pen strokes into a spatial summary instead of dumping all points
function condenseElements(elements: RawElement[]) {
  return elements.map(el => {
    if (el.type !== 'pen' || !el.points?.length) return el;

    const xs = el.points.map((p: { x: number; y: number }) => p.x);
    const ys = el.points.map((p: { x: number; y: number }) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const first = el.points[0];
    const last = el.points[el.points.length - 1];
    const startEndDist = Math.hypot(last.x - first.x, last.y - first.y);
    const isClosedShape = startEndDist < (maxX - minX + maxY - minY) * 0.2;

    return {
      id: el.id,
      type: 'pen',
      color: el.color,
      strokeWidth: el.strokeWidth,
      pointCount: el.points.length,
      boundingBox: {
        x: Math.round(minX), y: Math.round(minY),
        width: Math.round(maxX - minX), height: Math.round(maxY - minY),
      },
      startPoint: { x: Math.round(first.x), y: Math.round(first.y) },
      endPoint: { x: Math.round(last.x), y: Math.round(last.y) },
      isClosedShape,
      aspectRatio: +(((maxX - minX) / Math.max(maxY - minY, 1)).toFixed(2)),
    };
  });
}

export async function POST(req: Request) {
  const { elements } = await req.json();

  if (!elements?.length) {
    return new Response('Missing elements', { status: 400 });
  }

  // Mock mode
  if (process.env.MOCK_AI === 'true') {
    await new Promise(r => setTimeout(r, 600));
    const mock = {
      title: "Sample Flowchart",
      description: "A simple three-step process diagram showing a start node, a processing step, and an end state connected by arrows.",
      points: [
        "Contains 3 main nodes: Start, Process, and End",
        "Nodes connected with directional arrows showing flow",
        "Color-coded: neutral start, accent process, red end node"
      ]
    };
    return new Response(JSON.stringify(mock), { headers: { 'Content-Type': 'application/json' } });
  }


  // Compute overall bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const pts = el.type === 'pen'
      ? (el.points ?? [])
      : [{ x: el.x1, y: el.y1 }, { x: el.x2 ?? el.x1, y: el.y2 ?? el.y1 }];
    for (const p of pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }

  const textLabels = elements
    .filter((el: RawElement) => el.type === 'text' && el.text)
    .map((el: RawElement) => el.text);

  const condensed = condenseElements(elements);

  const elementBreakdown = {
    total: elements.length,
    byType: elements.reduce((acc: Record<string, number>, el: RawElement) => {
      acc[el.type] = (acc[el.type] ?? 0) + 1;
      return acc;
    }, {}),
  };

  const userMessage = `Summarize this whiteboard drawing.

Canvas region: (${Math.round(minX)}, ${Math.round(minY)}) to (${Math.round(maxX)}, ${Math.round(maxY)})
Element breakdown: ${JSON.stringify(elementBreakdown)}
${textLabels.length ? `Text labels: ${textLabels.map((t: string) => `"${t}"`).join(', ')}` : 'No text labels'}

Drawing elements (pen strokes condensed to spatial summaries):
${JSON.stringify(condensed, null, 2)}

Return only the JSON summary object.`;

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    const result = await model.generateContent(userMessage);
    const raw = result.response.text().trim();
    const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(clean);

    return new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Summarize error:', err);
    return new Response(JSON.stringify({ error: 'Failed to summarize' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}