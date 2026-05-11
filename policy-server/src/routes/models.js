// Model registry — serves model manifest and binary files to agents.
import { Router } from 'express';
import { createReadStream, statSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, '../../models');

const router = Router();

function sha256File(filePath) {
  try {
    const buf = readFileSync(filePath);
    return createHash('sha256').update(buf).digest('hex');
  } catch { return null; }
}

router.get('/manifest', (req, res) => {
  const modelId = 'auro-pii-indicv2';
  const version = '0.1.0';
  const modelDir = path.join(MODELS_DIR, modelId, version);

  const files = ['model.onnx', 'tokenizer.json', 'config.json', 'labels.json'];
  const fileMap = {};
  let totalSize = 0;

  for (const f of files) {
    const fp = path.join(modelDir, f);
    fileMap[f] = `/api/v1/models/${modelId}/${version}/${f}`;
    if (existsSync(fp)) {
      totalSize += statSync(fp).size;
    }
  }

  // Compute sha256 of model.onnx as the primary checksum
  const modelPath = path.join(modelDir, 'model.onnx');
  const sha = existsSync(modelPath) ? sha256File(modelPath) : 'unavailable';

  res.json({
    model_id: modelId,
    version,
    sha256: sha,
    size_bytes: totalSize,
    files: fileMap,
    onnxruntime: {
      'darwin-arm64': 'https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-osx-arm64-1.23.2.tgz',
      'linux-amd64': 'https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-linux-x64-1.23.2.tgz',
    },
  });
});

router.get('/:model_id/:version/:file', (req, res) => {
  const { model_id, version, file: fileName } = req.params;

  // Sanitize
  if (/[\/\\]/.test(model_id) || /[\/\\]/.test(version) || /[\/\\]/.test(fileName)) {
    return res.status(400).json({ error: 'invalid path' });
  }

  const allowed = ['model.onnx', 'tokenizer.json', 'config.json', 'labels.json'];
  if (!allowed.includes(fileName)) {
    return res.status(404).json({ error: 'not found' });
  }

  const fp = path.join(MODELS_DIR, model_id, version, fileName);
  if (!existsSync(fp)) {
    return res.status(404).json({ error: 'file not found' });
  }

  const stat = statSync(fp);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Type', 'application/octet-stream');
  createReadStream(fp).pipe(res);
});

export default router;
