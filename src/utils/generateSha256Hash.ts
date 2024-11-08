import * as crypto from "crypto";


export const generateSha256Hash = (password: string): string => {
    return crypto.createHash("sha256").update(password).digest("hex");
};
