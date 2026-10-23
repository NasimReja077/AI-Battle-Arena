import dotenv from 'dotenv';

dotenv.config();

const num = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : fallback;
}

// Configuration object to hold API keys, server settings and model prices
const config = {
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
    GROQ_API_KEY: process.env.GROQ_API_KEY || '',
    COHERE_API_KEY: process.env.COHERE_API_KEY || '',

    PORT: num(process.env.PORT, 3000),
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',

    // Leave empty to run without history (battles still work, they just are not saved)
    MONGODB_URI: process.env.MONGODB_URI || '',

    // USD per 1 million tokens. Override these in .env when provider pricing changes.
    PRICING: {
        groq: { inputPerM: num(process.env.PRICE_GROQ_IN, 0.15), outputPerM: num(process.env.PRICE_GROQ_OUT, 0.60) },
        cohere: { inputPerM: num(process.env.PRICE_COHERE_IN, 2.5), outputPerM: num(process.env.PRICE_COHERE_OUT, 10) },
        gemini: { inputPerM: num(process.env.PRICE_GEMINI_IN, 0.75), outputPerM: num(process.env.PRICE_GEMINI_OUT, 3.75) },
    },
}

export default config;
