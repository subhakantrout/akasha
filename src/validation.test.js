const { validateAnalysisData } = require('./validation');

describe('validateAnalysisData', () => {
  it('throws Error when data is null', () => {
    expect(() => validateAnalysisData(null)).toThrow('Invalid analysis data: must be an object');
  });

  it('throws Error when data is undefined', () => {
    expect(() => validateAnalysisData(undefined)).toThrow('Invalid analysis data: must be an object');
  });

  it('throws Error when data is a primitive (string)', () => {
    expect(() => validateAnalysisData('not an object')).toThrow('Invalid analysis data: must be an object');
  });

  it('throws Error when data.nodes is missing or not an array', () => {
    expect(() => validateAnalysisData({})).toThrow('Invalid analysis data: nodes must be an array');
    expect(() => validateAnalysisData({ nodes: 'not an array' })).toThrow('Invalid analysis data: nodes must be an array');
  });

  it('throws Error when data.edges is missing or not an array', () => {
    expect(() => validateAnalysisData({ nodes: [] })).toThrow('Invalid analysis data: edges must be an array');
    expect(() => validateAnalysisData({ nodes: [], edges: 'not an array' })).toThrow('Invalid analysis data: edges must be an array');
  });

  it('throws Error when a node has missing or non-string id', () => {
    const dataWithMissingId = { nodes: [{}], edges: [] };
    expect(() => validateAnalysisData(dataWithMissingId)).toThrow('Invalid node at index 0: missing or invalid id');

    const dataWithInvalidId = { nodes: [{ id: 123 }], edges: [] };
    expect(() => validateAnalysisData(dataWithInvalidId)).toThrow('Invalid node at index 0: missing or invalid id');
  });

  it('assigns node.type = "text" when node.type is missing or not a string', () => {
    const data = {
      nodes: [
        { id: 'node1' }, // Missing type
        { id: 'node2', type: 123 }, // Invalid type
      ],
      edges: []
    };

    const validatedData = validateAnalysisData(data);
    expect(validatedData.nodes[0].type).toBe('text');
    expect(validatedData.nodes[1].type).toBe('text');
  });

  it('successfully returns data and does not overwrite valid string node.type', () => {
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
    expect(validatedData).toEqual(data);
    expect(validatedData.nodes[0].type).toBe('image');
    expect(validatedData.nodes[1].type).toBe('video');
  });
});
