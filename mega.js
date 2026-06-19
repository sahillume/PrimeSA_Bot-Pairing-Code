```javascript
import * as mega from 'megajs';

// ===========================================
// PrimeSA_Bot - MEGA Cloud Configuration
// ===========================================

const auth = {
    email: 'your-email@example.com',
    password: 'your-password',
    userAgent: 'PrimeSA_Bot/1.0 (Node.js)'
};

// ===========================================
// Upload Session/File to MEGA
// ===========================================

export const upload = (data, name) => {
    return new Promise((resolve, reject) => {
        try {
            const storage = new mega.Storage(auth, () => {

                const uploadStream = storage.upload({
                    name,
                    allowUploadBuffering: true
                });

                data.pipe(uploadStream);

                storage.on("add", (file) => {

                    file.link((err, url) => {

                        if (err) return reject(err);

                        storage.close();
                        resolve(url);

                    });

                });

                storage.on("error", reject);

            });

        } catch (err) {
            reject(err);
        }
    });
};

// ===========================================
// Download Session/File from MEGA
// ===========================================

export const download = (url) => {
    return new Promise((resolve, reject) => {

        try {

            const file = mega.File.fromURL(url);

            file.loadAttributes((err) => {

                if (err) return reject(err);

                file.downloadBuffer((err, buffer) => {

                    if (err) return reject(err);

                    resolve(buffer);

                });

            });

        } catch (err) {
            reject(err);
        }

    });
};
```
