import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: Request) {
  const { audio, mimeType } = await req.json();

  if (!audio) {
    return new Response('Missing audio', { status: 400 });
  }

  // Mock mode
  if (process.env.MOCK_AI === 'true') {
    await new Promise(r => setTimeout(r, 400));
    return new Response(JSON.stringify({ text: 'a simple flowchart with three steps' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType ?? 'audio/webm',
          data: audio,
        },
      },
      {
        text: 'Transcribe exactly what is spoken in this audio clip. Return only the transcribed text, nothing else — no punctuation fixes, no commentary, no quotes.',
      },
    ]);

    const text = result.response.text().trim();

    return new Response(JSON.stringify({ text }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Transcription error:', err);
    return new Response(JSON.stringify({ error: 'Transcription failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}