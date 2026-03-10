'use strict';

const mockOccHandler = jest.fn();
const mockSupportHandler = jest.fn();
const mockCrmHandler = jest.fn();

jest.mock('../operationalOccRoutes', () => ({
  handleOperationalOccRoutes: (...args) => mockOccHandler(...args),
}));

jest.mock('../operationalSupportRoutes', () => ({
  handleOperationalSupportRoutes: (...args) => mockSupportHandler(...args),
}));

jest.mock('../crmRoutes', () => ({
  handleCrmRoutes: (...args) => mockCrmHandler(...args),
}));

const {
  registerRouteLoaders,
  handleRegisteredRoutes,
} = require('../index');

describe('api/routes index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers the expected route groups', () => {
    const groups = registerRouteLoaders();

    expect(groups.operational).toEqual({
      name: 'operational',
      handle: expect.any(Function),
    });
    expect(groups.support).toEqual({
      name: 'support',
      handle: expect.any(Function),
    });
    expect(groups.crm).toEqual({
      name: 'crm',
      handle: expect.any(Function),
    });
  });

  it('dispatches handlers in order and stops after the first match', async () => {
    mockOccHandler.mockResolvedValue(false);
    mockSupportHandler.mockResolvedValue(true);
    mockCrmHandler.mockResolvedValue(false);

    const groups = registerRouteLoaders();
    const context = { pathname: '/api/test' };
    const handled = await handleRegisteredRoutes({
      groups: [groups.operational, groups.support, groups.crm],
      context,
    });

    expect(handled).toBe(true);
    expect(mockOccHandler).toHaveBeenCalledWith(context);
    expect(mockSupportHandler).toHaveBeenCalledWith(context);
    expect(mockCrmHandler).not.toHaveBeenCalled();
  });
});
