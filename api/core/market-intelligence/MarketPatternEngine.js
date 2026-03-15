'use strict';

const { MarketPattern } = require('../../db/models');

class MarketPatternEngine {
  async detectPatterns(vertical = 'global', options = {}) {
    const PatternModel = MarketPattern();
    const where = {
      vertical: String(vertical || 'global'),
    };

    if (options.patternType) {
      where.pattern_type = String(options.patternType);
    }

    const rows = await PatternModel.findAll({
      where,
      order: [['detected_at', 'DESC'], ['created_at', 'DESC']],
      limit: Math.min(Math.max(Number(options.limit) || 50, 1), 200),
    });

    return (rows || []).map((row) => this._sanitizePattern(row.toJSON ? row.toJSON() : row));
  }

  _sanitizePattern(item = {}) {
    return {
      id: item.id,
      vertical: item.vertical,
      pattern_type: item.pattern_type,
      description: item.description,
      confidence: item.confidence,
      detected_at: item.detected_at,
      metadata: {
        source: item?.metadata?.source || 'market_intelligence_layer',
      },
    };
  }
}

module.exports = {
  MarketPatternEngine,
};
