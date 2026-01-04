/**
 * Parser de multipart/form-data usando busboy
 */

const Busboy = require('busboy');
const logger = require('./logger');

/**
 * Processa requisição multipart/form-data
 * 
 * @param {http.IncomingMessage} req - Requisição HTTP
 * @returns {Promise<{fields: Object, files: Array}>} Campos e arquivos
 */
function parseMultipartFormData(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    const fields = {};
    const files = [];

    busboy.on('file', (name, file, info) => {
      const { filename, encoding, mimeType } = info;
      const chunks = [];
      let size = 0;

      file.on('data', (data) => {
        chunks.push(data);
        size += data.length;
      });

      file.on('end', () => {
        files.push({
          fieldname: name,
          filename,
          encoding,
          mimeType,
          buffer: Buffer.concat(chunks),
          size,
        });
      });
    });

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('finish', () => {
      resolve({ fields, files });
    });

    busboy.on('error', (err) => {
      logger.error('Erro ao processar multipart/form-data:', err);
      reject(err);
    });

    req.pipe(busboy);
  });
}

module.exports = {
  parseMultipartFormData,
};

