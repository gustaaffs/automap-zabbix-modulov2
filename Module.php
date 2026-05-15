<?php

namespace Modules\AutomapTopology;

use Zabbix\Core\CModule;
use CMenuItem;

class Module extends CModule {

	public function init(): void {
		APP::Component()->getMenu()
			->findOrAdd(_('Monitoring'))
			->add(
				(new CMenuItem(_('AutoMap')))
					->setAction('automap.topology.view')
			);
	}
}
