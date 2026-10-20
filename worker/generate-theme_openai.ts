import {
    detectOpenAICompatibleProvider,
    sendOpenAICompatibleRequest,
} from '../shared/openAICompatibleRequest.mjs';
import { sanitizeDualTheme } from '../shared/themeSanitizer.mjs';
import {
    THEME_JSON_SCHEMA,
    buildThemeSourcePrompt,
    buildThemeSystemPrompt,
} from '../shared/themeGenerationPrompt.mjs';

type WorkerEnv = {
    OPENAI_API_KEY?: string;
    OPENAI_API_URL?: string;
    OPENAI_API_MODEL?: string;
    OPENAI_API_TEMPERATURE?: string;
};

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';
const DEFAULT_OPENAI_TEMPERATURE = 0.7;
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';
const THEME_JSON_SCHEMA_NAME = 'dual_theme';
const THEME_MAX_OUTPUT_TOKENS = 4096;

type OpenAICompatibleProvider = 'openai' | 'deepseek' | 'generic';

const normalizeOpenAIChatCompletionsUrl = (rawUrl?: string) => {
    const trimmedUrl = rawUrl?.trim();
    if (!trimmedUrl) {
        return DEFAULT_OPENAI_CHAT_COMPLETIONS_URL;
    }

    try {
        const parsed = new URL(trimmedUrl);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '');

        if (!normalizedPath || normalizedPath === '/') {
            parsed.pathname = '/v1/chat/completions';
            return parsed.toString();
        }

        if (/\/v\d+$/.test(normalizedPath)) {
            parsed.pathname = `${normalizedPath}/chat/completions`;
            return parsed.toString();
        }

        parsed.pathname = normalizedPath;
        return parsed.toString();
    } catch {
        return trimmedUrl.replace(/\/+$/, '');
    }
};

const resolveOpenAICompatibleModel = (apiUrl: string, configuredModel?: string) => {
    const trimmedModel = configuredModel?.trim();
    if (trimmedModel) {
        return trimmedModel;
    }

    return detectOpenAICompatibleProvider(apiUrl) === 'deepseek' ? DEEPSEEK_DEFAULT_MODEL : DEFAULT_OPENAI_MODEL;
};

const providerSupportsStructuredOutputs = (provider: OpenAICompatibleProvider) => provider === 'openai';

const extractProviderErrorMessage = (payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const error = (payload as { error?: unknown; }).error;
    if (typeof error === 'string') {
        return error;
    }

    if (error && typeof error === 'object') {
        const message = (error as { message?: unknown; }).message;
        if (typeof message === 'string') {
            return message;
        }
    }

    const message = (payload as { message?: unknown; }).message;
    return typeof message === 'string' ? message : null;
};

const formatOpenAICompatibleError = async (response: Response) => {
    const rawText = await response.text();
    let detail = rawText.trim();

    try {
        const parsed = JSON.parse(rawText);
        detail = extractProviderErrorMessage(parsed) || detail;
    } catch {
        // Leave non-JSON responses as-is.
    }

    return detail
        ? `OpenAI compatible API error (${response.status}): ${detail}`
        : `OpenAI compatible API error (${response.status}): ${response.statusText}`;
};

const buildOpenAICompatibleRequestBody = (
    model: string,
    provider: OpenAICompatibleProvider,
    systemPrompt: string,
    sourcePrompt: string,
    temperature: number
) => {
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sourcePrompt }
    ];

    if (providerSupportsStructuredOutputs(provider)) {
        return {
            model,
            messages,
            temperature,
            max_completion_tokens: THEME_MAX_OUTPUT_TOKENS,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: THEME_JSON_SCHEMA_NAME,
                    strict: true,
                    schema: THEME_JSON_SCHEMA
                }
            }
        };
    }

    return {
        model,
        messages,
        temperature,
        max_tokens: 8192,
        response_format: { type: 'json_object' }
    };
};

const extractResponseContentText = (message: { content?: unknown; refusal?: unknown; } | undefined) => {
    if (!message) {
        return null;
    }

    if (typeof message.refusal === 'string' && message.refusal.trim()) {
        throw new Error(`Model refused request: ${message.refusal}`);
    }

    if (typeof message.content === 'string') {
        return message.content;
    }

    if (Array.isArray(message.content)) {
        const text = message.content
            .filter((part): part is { type?: unknown; text?: unknown; } => !!part && typeof part === 'object')
            .filter((part) => part.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('');
        return text || null;
    }

    return null;
};

export async function handleGenerateOpenAITheme(request: Request, env: WorkerEnv) {
    if (request.method !== 'POST') {
        return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    }

    try {
        const { lyricsText, isPureMusic = false, songTitle } = await request.json() as {
            lyricsText?: string;
            isPureMusic?: boolean;
            songTitle?: string;
        };

        if (!lyricsText) {
            return Response.json({ error: 'Missing lyricsText' }, { status: 400 });
        }

        const apiKey = env.OPENAI_API_KEY;
        const apiUrl = normalizeOpenAIChatCompletionsUrl(env.OPENAI_API_URL);
        const model = resolveOpenAICompatibleModel(apiUrl, env.OPENAI_API_MODEL);
        const configuredTemperature = Number.parseFloat(env.OPENAI_API_TEMPERATURE?.trim() || '');
        const temperature = Number.isFinite(configuredTemperature) && configuredTemperature >= 0 && configuredTemperature <= 2
            ? configuredTemperature
            : DEFAULT_OPENAI_TEMPERATURE;
        const provider = detectOpenAICompatibleProvider(apiUrl) as OpenAICompatibleProvider;

        if (!apiKey) {
            console.error('OpenAI API Key is missing in server environment.');
            return Response.json({ error: 'Server configuration error' }, { status: 500 });
        }

        // Limit text to avoid token limits if lyrics are huge
        const snippet = lyricsText.slice(0, 2000);
        const systemPrompt = buildThemeSystemPrompt(true);
        const sourcePrompt = buildThemeSourcePrompt(snippet, isPureMusic, songTitle);

        const response = await sendOpenAICompatibleRequest({
            apiUrl,
            provider,
            body: buildOpenAICompatibleRequestBody(model, provider, systemPrompt, sourcePrompt, temperature),
            init: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                signal: AbortSignal.timeout(120_000),
            },
        });

        if (!response.ok) {
            const errorMessage = await formatOpenAICompatibleError(response);
            console.error('OpenAI API Error:', errorMessage);
            throw new Error(errorMessage);
        }

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: unknown; refusal?: unknown; }; }>;
        };
        const content = extractResponseContentText(data.choices?.[0]?.message);

        if (!content) {
            throw new Error('Failed to generate theme JSON');
        }

        // Attempt to parse JSON
        let dualTheme;
        let jsonStr = content.trim();

        // Remove markdown code blocks if present
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
        }

        try {
            dualTheme = sanitizeDualTheme(JSON.parse(jsonStr));
        } catch (e) {
            console.error('Failed to parse JSON from AI response:', jsonStr);
            throw new Error('Invalid JSON response from AI');
        }

        // Force fixed properties for both themes
        dualTheme.light.fontStyle = 'sans';
        dualTheme.light.provider = 'OpenAI Compatible';
        dualTheme.dark.fontStyle = 'sans';
        dualTheme.dark.provider = 'OpenAI Compatible';

        return Response.json(dualTheme);
    } catch (error) {
        console.error('Error generating theme:', error);
        const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
        return Response.json({ error: errorMessage }, { status: 500 });
    }
}
