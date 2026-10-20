import { buildThemeSourcePrompt, buildThemeSystemPrompt } from '../../shared/themeGenerationPrompt.mjs';
import { sanitizeDualTheme } from '../../shared/themeSanitizer.mjs';

// POST /theme — the web build's theme ask, answered by the Makers AI Gateway.
// Route path stays outside /api/* so it is not shadowed by the cloud-function catch-all.

const MODEL = '@makers/deepseek-v4-pro';
const REASONING_EFFORT = 'low';
const MAX_OUTPUT_TOKENS = 8192;
const REQUEST_TIMEOUT_MS = 110_000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
});

const extractResponseText = (content: unknown): string | null => {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        const text = content
            .filter((part): part is { type?: unknown; text?: unknown } => Boolean(part) && typeof part === 'object')
            .filter(part => part.type === 'text' && typeof part.text === 'string')
            .map(part => part.text)
            .join('');
        return text || null;
    }
    return null;
};

const parseThemeJson = (content: string): unknown => {
    const trimmed = content.trim();
    const withoutFence = trimmed.startsWith('```')
        ? trimmed.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
        : trimmed;
    return JSON.parse(withoutFence);
};

export async function onRequest(context: any) {
    if (context.request.method !== 'POST') {
        return json({ error: 'Method Not Allowed' }, 405);
    }

    const body = context.request.body ?? {};
    const { lyricsText, isPureMusic = false, songTitle } = body as {
        lyricsText?: string;
        isPureMusic?: boolean;
        songTitle?: string;
    };

    if (!lyricsText) {
        return json({ error: 'Missing lyricsText' }, 400);
    }

    const env = context.env ?? {};
    const apiKey = env.AI_GATEWAY_API_KEY;
    const baseUrl = env.AI_GATEWAY_BASE_URL;
    if (!apiKey || !baseUrl) {
        console.error('[theme-agent] AI Gateway environment is missing');
        return json({ error: 'Server configuration error' }, 500);
    }

    const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
    if (context.request.signal) {
        signals.push(context.request.signal);
    }

    try {
        const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: buildThemeSystemPrompt(true) },
                    { role: 'user', content: buildThemeSourcePrompt(lyricsText.slice(0, 2000), isPureMusic, songTitle) },
                ],
                reasoning_effort: REASONING_EFFORT,
                max_tokens: MAX_OUTPUT_TOKENS,
                response_format: { type: 'json_object' },
            }),
            signal: AbortSignal.any(signals),
        });

        if (!response.ok) {
            const detail = await response.text();
            console.error('[theme-agent] gateway error', response.status, detail.slice(0, 500));
            return json({ error: `Theme generation failed (${response.status})` }, 502);
        }

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: unknown } }>;
        };
        const content = extractResponseText(data.choices?.[0]?.message?.content);
        if (!content) {
            throw new Error('The model returned no content');
        }

        const theme = sanitizeDualTheme(parseThemeJson(content));
        theme.light.fontStyle = 'sans';
        theme.light.provider = 'Makers';
        theme.dark.fontStyle = 'sans';
        theme.dark.provider = 'Makers';
        return json(theme);
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return json({ error: 'Theme generation timed out' }, 504);
        }
        console.error('[theme-agent] failed:', error);
        return json({ error: 'Theme generation failed' }, 500);
    }
}
