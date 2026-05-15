<?php

namespace Modules\AutomapTopology;

use Zabbix\Core\CModule;

class Module extends CModule {

	public function init(): void {
		try {
			$menu = method_exists(\APP::Component(), 'getMenu')
				? \APP::Component()->getMenu()
				: \APP::getInstance()->getMenu();

			$menu->findOrAdd(_('Monitoring'))
				->add(
					(new \CMenuItem(_('AutoMap')))
						->setAction('automap.topology.view')
				);
		} catch (\Throwable $e) {
		}
	}
}
