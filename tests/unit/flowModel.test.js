'use strict';

describe('Flow model resolver', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('retorna proxy com erro claro quando sequelize nao esta inicializado', () => {
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => null),
    }));

    const getFlowModel = require('../../api/db/models/Flow');

    expect(() => getFlowModel().findAll()).toThrow('Sequelize não inicializado. Chame connect() primeiro.');
  });

  test('recria o model quando a instancia do sequelize muda', () => {
    const sequelizeA = { define: jest.fn() };
    const sequelizeB = { define: jest.fn() };

    sequelizeA.define.mockImplementation(() => ({ sequelize: sequelizeA, source: 'A' }));
    sequelizeB.define.mockImplementation(() => ({ sequelize: sequelizeB, source: 'B' }));

    const getSequelize = jest
      .fn()
      .mockReturnValueOnce(sequelizeA)
      .mockReturnValueOnce(sequelizeA)
      .mockReturnValueOnce(sequelizeB);

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize }));

    const getFlowModel = require('../../api/db/models/Flow');

    const firstModel = getFlowModel();
    const secondModel = getFlowModel();
    const thirdModel = getFlowModel();

    expect(sequelizeA.define).toHaveBeenCalledTimes(1);
    expect(firstModel).toBe(secondModel);
    expect(sequelizeB.define).toHaveBeenCalledTimes(1);
    expect(thirdModel).not.toBe(firstModel);
    expect(thirdModel.source).toBe('B');
  });
});