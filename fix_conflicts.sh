cat << 'PACKAGEJSON' > package.json
{
  "name": "akasha",
  "version": "1.0.0",
  "description": "Sovereign Vedic Intelligence Portal",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js",
    "test": "node --test"
  },
  "keywords": [
    "vedic",
    "knowledge",
    "graph"
  ],
  "author": "",
  "license": "MIT",
  "type": "commonjs",
  "dependencies": {
    "cheerio": "^1.2.0",
    "compression": "^1.7.4",
    "cors": "^2.8.6",
    "dotenv": "^16.4.7",
    "epub2": "^3.0.2",
    "express": "^4.21.2",
    "fs-extra": "^11.3.5",
    "mammoth": "^1.12.0",
    "node-fetch": "^2.7.0",
    "officeparser": "^6.1.1",
    "pdf-parse": "^2.4.5",
    "tesseract.js": "^7.0.0"
  },
  "devDependencies": {
    "jest": "^30.4.2"
  }
}
PACKAGEJSON

cat << 'TESTFILE' > src/validation.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { sanitizeFilePath, validateAnalysisData } = require('./validation');

test('sanitizeFilePath', async (t) => {
  const baseDir = '/var/data';

  await t.test('allows paths within base directory', () => {
    const result = sanitizeFilePath('/var/data/file.txt', baseDir);
    assert.strictEqual(result, path.resolve('/var/data/file.txt'));
  });

  await t.test('allows paths within nested subdirectories', () => {
    const result = sanitizeFilePath('/var/data/nested/sub/file.txt', baseDir);
    assert.strictEqual(result, path.resolve('/var/data/nested/sub/file.txt'));
  });

  await t.test('allows exact match of base directory', () => {
    const result = sanitizeFilePath('/var/data', baseDir);
    assert.strictEqual(result, path.resolve('/var/data'));
  });

  await t.test('allows exact match of base directory with trailing slash', () => {
    const result = sanitizeFilePath('/var/data/', baseDir);
    assert.strictEqual(result, path.resolve('/var/data'));
  });

  await t.test('blocks path traversal attempts (../)', () => {
    assert.throws(
      () => sanitizeFilePath('/var/data/../secrets.txt', baseDir),
      /Path traversal attempt detected/
    );
  });

  await t.test('blocks absolute paths outside base directory', () => {
    assert.throws(
      () => sanitizeFilePath('/etc/passwd', baseDir),
      /Path traversal attempt detected/
    );
  });

  await t.test('blocks prefix confusion attempts', () => {
    assert.throws(
      () => sanitizeFilePath('/var/data-secrets/file.txt', baseDir),
      /Path traversal attempt detected/
    );
  });
});

test('validateAnalysisData', async (t) => {
  await t.test('throws Error when data is null', () => {
    assert.throws(() => validateAnalysisData(null), /Invalid analysis data: must be an object/);
  });

  await t.test('throws Error when data is undefined', () => {
    assert.throws(() => validateAnalysisData(undefined), /Invalid analysis data: must be an object/);
  });

  await t.test('throws Error when data is a primitive (string)', () => {
    assert.throws(() => validateAnalysisData('not an object'), /Invalid analysis data: must be an object/);
  });

  await t.test('throws Error when data.nodes is missing or not an array', () => {
    assert.throws(() => validateAnalysisData({}), /Invalid analysis data: nodes must be an array/);
    assert.throws(() => validateAnalysisData({ nodes: 'not an array' }), /Invalid analysis data: nodes must be an array/);
  });

  await t.test('throws Error when data.edges is missing or not an array', () => {
    assert.throws(() => validateAnalysisData({ nodes: [] }), /Invalid analysis data: edges must be an array/);
    assert.throws(() => validateAnalysisData({ nodes: [], edges: 'not an array' }), /Invalid analysis data: edges must be an array/);
  });

  await t.test('throws Error when a node has missing or non-string id', () => {
    const dataWithMissingId = { nodes: [{}], edges: [] };
    assert.throws(() => validateAnalysisData(dataWithMissingId), /Invalid node at index 0: missing or invalid id/);

    const dataWithInvalidId = { nodes: [{ id: 123 }], edges: [] };
    assert.throws(() => validateAnalysisData(dataWithInvalidId), /Invalid node at index 0: missing or invalid id/);
  });

  await t.test('assigns node.type = "text" when node.type is missing or not a string', () => {
    const data = {
      nodes: [
        { id: 'node1' }, // Missing type
        { id: 'node2', type: 123 }, // Invalid type
      ],
      edges: []
    };

    const validatedData = validateAnalysisData(data);
    assert.strictEqual(validatedData.nodes[0].type, 'text');
    assert.strictEqual(validatedData.nodes[1].type, 'text');
  });

  await t.test('successfully returns data and does not overwrite valid string node.type', () => {
    const data = {
      nodes: [
        { id: 'node1', type: 'image' },
        { id: 'node2', type: 'video' },
      ],
      edges: [
        { source: 'node1', target: 'node2' }
      ]
    };

    const validatedData = validateAnalysisData(data);
    assert.deepStrictEqual(validatedData, data);
    assert.strictEqual(validatedData.nodes[0].type, 'image');
    assert.strictEqual(validatedData.nodes[1].type, 'video');
  });
});
TESTFILE
