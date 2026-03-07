jest.mock('expo-av', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Video: (props: Record<string, unknown>) => React.createElement(View, props),
  };
});
