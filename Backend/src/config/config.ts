import dotenv from 'dotenv';

dotenv.config();

// Configuration object to hold API keys for different AI models
const config = {
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
    MISTRALAI_API_KEY: process.env.MISTRAL_API_KEY || '',
    COHERE_API_KEY: process.env.COHERE_API_KEY || '',
}

export default config;