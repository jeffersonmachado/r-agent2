import React from 'react';
import { PbxPage as PbxPageImpl } from './PbxPage.impl';

// CrudPageBase permanece na implementação principal (PbxPage.impl), quando aplicável.
export function PbxPage(props) {
	return <PbxPageImpl {...props} />;
}
