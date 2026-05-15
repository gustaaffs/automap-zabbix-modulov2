<?php

namespace Modules\AutomapTopology;

use Zabbix\Core\CModule;

class Module extends CModule {

	public function init(): void {
		\APP::Component()->get('menu.main')
			->findOrAdd(_('Monitoring'))
			->getSubmenu()
			->add(
				(new \CMenuItem(_('AutoMap')))
					->setAction('automap.topology.view')
			);
	}
}
