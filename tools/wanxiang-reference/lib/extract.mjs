import { parse } from 'acorn';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function propertyName(property) {
  if (property.computed || property.kind !== 'init' || property.method || property.shorthand) {
    return null;
  }

  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
  return null;
}

function shallowProperties(node) {
  if (node?.type !== 'ObjectExpression') return null;
  const properties = new Map();

  for (const property of node.properties) {
    const key = propertyName(property);
    if (key === null || DANGEROUS_KEYS.has(key) || properties.has(key)) continue;
    properties.set(key, property.value);
  }

  return properties;
}

function shallowLiteral(node) {
  if (node?.type === 'Literal') return node.value;
  if (node?.type === 'UnaryExpression' && ['!', '+', '-'].includes(node.operator)) {
    const argument = shallowLiteral(node.argument);
    if (typeof argument !== 'number' && typeof argument !== 'boolean') return undefined;
    if (node.operator === '!') return !argument;
    return node.operator === '+' ? +argument : -argument;
  }
  return undefined;
}

function isTalentArray(node) {
  if (node.type !== 'ArrayExpression' || node.elements.length === 0) return false;
  const first = shallowProperties(node.elements[0]);
  if (!first) return false;
  const type = shallowLiteral(first.get('type'));
  return type === 'talent';
}

function isCommanderArray(node) {
  if (node.type !== 'ArrayExpression' || node.elements.length === 0) return false;
  const first = shallowProperties(node.elements[0]);
  if (!first) return false;
  const id = shallowLiteral(first.get('id'));
  return typeof id === 'string'
    && id.startsWith('commander-');
}

function readLiteral(node, path = '$') {
  switch (node.type) {
    case 'Literal':
      if (![null, 'string', 'number', 'boolean'].includes(node.value === null ? null : typeof node.value)) {
        throw new Error(`${path}: only null, string, number, and boolean literals are supported`);
      }
      if (typeof node.value === 'number' && !Number.isFinite(node.value)) {
        throw new Error(`${path}: numeric literals must be finite`);
      }
      return node.value;
    case 'UnaryExpression': {
      if (!['!', '+', '-'].includes(node.operator)) {
        throw new Error(`${path}: unsupported unary operator ${node.operator}`);
      }
      const value = readLiteral(node.argument, `${path} unary argument`);
      if (typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`${path}: unary ${node.operator} requires a number or boolean`);
      }
      if (node.operator === '!') return !value;
      return node.operator === '+' ? +value : -value;
    }
    case 'ArrayExpression':
      return node.elements.map((element, index) => {
        if (!element) throw new Error(`${path}[${index}]: sparse arrays are not supported`);
        if (element.type === 'SpreadElement') throw new Error(`${path}[${index}]: spread is not allowed`);
        return readLiteral(element, `${path}[${index}]`);
      });
    case 'ObjectExpression': {
      const result = Object.create(null);
      const seen = new Set();
      for (const property of node.properties) {
        if (property.type === 'SpreadElement') throw new Error(`${path}: object spread is not allowed`);
        const key = propertyName(property);
        if (key === null) throw new Error(`${path}: computed, accessor, method, or shorthand property is not allowed`);
        if (DANGEROUS_KEYS.has(key)) throw new Error(`${path}: dangerous object key ${key} is not allowed`);
        if (seen.has(key)) throw new Error(`${path}: duplicate object key ${key} is not allowed`);
        seen.add(key);
        result[key] = readLiteral(property.value, `${path}.${key}`);
      }
      return result;
    }
    default:
      throw new Error(`${path}: executable or unsupported ${node.type} expression is not allowed`);
  }
}

function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') callback(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end' || key === 'loc') continue;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, callback);
    } else if (value && typeof value === 'object') {
      visit(value, callback);
    }
  }
}

function parseSource(source, sourceUrl) {
  try {
    return parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  } catch (error) {
    throw new Error(`Could not parse ${sourceUrl}: ${error.message}`, { cause: error });
  }
}

function assertHomogeneous(records, label, predicate) {
  if (records.length === 0 || !records.every(predicate)) {
    throw new Error(`Detected ${label} array is incomplete or contains an invalid record`);
  }
}

export function extractReferenceData(source, { sourceUrl = '<source>' } = {}) {
  const ast = parseSource(source, sourceUrl);

  const talents = [];
  const commanders = [];
  const relatedSourceRecords = [];
  let detectedArrays = 0;

  visit(ast, (node) => {
    if (node.type === 'ArrayExpression') {
      const talentCandidate = isTalentArray(node);
      const commanderCandidate = !talentCandidate && isCommanderArray(node);
      if (talentCandidate || commanderCandidate) {
        detectedArrays += 1;
        let records;
        try {
          records = readLiteral(node, talentCandidate ? 'talents' : 'commanders');
        } catch (error) {
          throw new Error(`Unsafe or non-literal data array in ${sourceUrl}: ${error.message}`, { cause: error });
        }
        if (!Array.isArray(records)) throw new Error(`${sourceUrl}: detected data did not produce an array`);
        if (talentCandidate) {
          assertHomogeneous(records, 'talent', (record) =>
            record && typeof record === 'object'
              && record.type === 'talent'
              && Number.isInteger(record.id)
              && ['wanxiang', 'diamond'].includes(record.gameType)
              && typeof record.name === 'string'
              && [1, 2, 3].includes(record.quality)
              && typeof record.description === 'string'
              && typeof record.cardGetDescription === 'string');
          talents.push(...records);
        } else {
          assertHomogeneous(records, 'commander', (record) =>
            record && typeof record === 'object'
              && typeof record.id === 'string'
              && record.id.startsWith('commander-')
              && Number.isInteger(record.lordId)
              && Number.isInteger(record.roleIndex)
              && typeof record.name === 'string'
              && Array.isArray(record.sections));
          commanders.push(...records);
        }
        return;
      }
    }

    if (node.type === 'ObjectExpression') {
      const props = shallowProperties(node);
      if (!props) return;
      const type = shallowLiteral(props.get('type'));
      if (!['hero', 'effect', 'equipment'].includes(type) || (!props.has('id') && !props.has('name'))) return;
      let record;
      try {
        record = readLiteral(node, 'related card');
      } catch (error) {
        throw new Error(`Unsafe or non-literal related card in ${sourceUrl}: ${error.message}`, { cause: error });
      }
      if (!(Number.isSafeInteger(record.id) || typeof record.id === 'string')
        || typeof record.name !== 'string'
        || !['wanxiang', 'diamond'].includes(record.gameType)) {
        throw new Error(`${sourceUrl}: detected related card is incomplete or has invalid id, name, or gameType`);
      }
      relatedSourceRecords.push(record);
    }
  });

  return { talents, commanders, relatedSourceRecords, detectedArrays };
}

export function readStaticLiteral(node) {
  return readLiteral(node);
}

export function discoverScriptLinks(source, { sourceUrl = '<source>' } = {}) {
  const ast = parseSource(source, sourceUrl);
  const links = [];
  visit(ast, (node) => {
    if (node.type === 'Literal' && typeof node.value === 'string' && /\.js(?:[?#].*)?$/i.test(node.value)) {
      links.push(node.value);
    }
  });
  return links;
}
