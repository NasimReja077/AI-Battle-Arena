import config from "./src/config/config.js";
import { createApp } from "./src/app.js";
import { MongoStore, connectMongo } from "./src/store/mongo.store.js";

const store = new MongoStore();

if (config.MONGODB_URI) {
    connectMongo(config.MONGODB_URI);
} else {
    console.warn("MONGODB_URI is not set: battles work, but history, sharing and export are off.");
}

const app = createApp({ store, corsOrigin: config.CORS_ORIGIN });

app.listen(config.PORT, () => {
    console.log(`Server is running on port ${config.PORT}`);
})
