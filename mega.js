import * as mega from 'megajs';

// Mega authentication credentials - use environment variables for safety
const auth = {
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD,
    userAgent: 'PrimeSA_Bot/1.0'
};

// Function to upload a file to Mega and return the URL
export const upload = (data, name) => {
    return new Promise((resolve, reject) => {
        try {
            // Authenticate with Mega storage
            const storage = new mega.Storage(auth, () => {
                // Upload the data stream (e.g., file stream) to Mega
                const uploadStream = storage.upload({ name: name, allowUploadBuffering: true });

                // Validate the provided stream
                if (!data || typeof data.pipe !== 'function') {
                    if (storage) storage.close();
                    return reject(new Error('Invalid upload stream.'));
                }

                // Track when the upload stream finishes
                let uploadStreamFinished = false;
                uploadStream.on('finish', () => {
                    uploadStreamFinished = true;
                });

                // Pipe the data into Mega
                data.pipe(uploadStream);

                // When a file is added to storage, ensure it's the uploaded file and that
                // the upload stream has finished before generating and returning the link.
                const onAdd = (file) => {
                    try {
                        if (!uploadStreamFinished) return; // wait until our stream finishes
                        if (!file || file.name !== name) return; // ignore other files

                        file.link((err, url) => {
                            if (err) {
                                if (storage) storage.close();
                                return reject(new Error(`Mega upload failed: ${err.message}`));
                            } else {
                                if (storage) storage.close();
                                return resolve(url);
                            }
                        });
                    } catch (e) {
                        if (storage) storage.close();
                        return reject(new Error(`Mega upload failed: ${e.message}`));
                    }
                };

                storage.on('add', onAdd);

                // Handle errors during file upload process
                storage.on('error', (error) => {
                    if (storage) storage.close();
                    reject(new Error(`Mega upload failed: ${error.message}`));
                });
            });
        } catch (err) {
            reject(new Error(`Mega upload failed: ${err.message}`));
        }
    });
};

// Function to download a file from Mega using a URL
export const download = (url) => {
    return new Promise((resolve, reject) => {
        try {
            // Get file from Mega using the URL
            const file = mega.File.fromURL(url);

            file.loadAttributes((err) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Download the file buffer
                file.downloadBuffer((err, buffer) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(buffer); // Return the file buffer
                    }
                });
            });
        } catch (err) {
            reject(err);
        }
    });
};

