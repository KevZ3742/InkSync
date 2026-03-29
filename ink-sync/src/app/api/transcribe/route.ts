export async function POST(req: Request) {
  const { audio, mimeType } = await req.json();

  if (!audio) return new Response('Missing audio', { status: 400 });

  if (process.env.MOCK_AI === 'true') {
    await new Promise(r => setTimeout(r, 400));
    return new Response(JSON.stringify({ text: 'a simple flowchart with three steps' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const binary = Buffer.from(audio, 'base64');
    const blob = new Blob([binary], { type: mimeType ?? 'audio/webm' });

    const formData = new FormData();
    formData.append('file', blob, `audio.${mimeType?.split('/')[1] ?? 'webm'}`);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'json');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Groq Whisper error:', err);
      throw new Error(`Groq returned ${response.status}`);
    }

    const result = await response.json();
    return new Response(JSON.stringify({ text: result.text?.trim() ?? '' }), {
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