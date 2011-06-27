// global imports
const DBus = imports.dbus;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

// shell imports
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

// localization
const Gettext = imports.gettext.domain('gnome-shell');
const _ = Gettext.gettext;

const N_VISIBLE_NETWORKS = 5;

// DBus interface
const CMManagerInterface = {
    name: 'net.connman.Manager',
    methods: [
        { name: 'GetProperties', inSignature: '', outSignature: 'a{sv}' },
        { name: 'SetProperty', inSignature: 'sv', outSignature: '' },
        { name: 'GetState', inSignature: '', outSignature: 's' },
        { name: 'GetServices', inSignature: '', outSignature: 'a(oa{sv})' },
        { name: 'EnableTechnology', inSignature: 's', outSignature: '' },
        { name: 'DisableTechnology', inSignature: 's', outSignature: '' },
    ],
    signals: [
        { name: 'PropertyChanged', inSignature: 'sv', outSignature: '' },
        { name: 'StateChanged', inSignature: 's', outSignature: '' },
    ]
};

const CMServiceInterface = {
    name: 'net.connman.Service',
    methods: [
        { name: 'GetProperties', inSignature: '', outSignature: 'a{sv}' },
        { name: 'SetProperty', inSignature: 'sv', outSignature: '' },
        { name: 'ClearProperty', inSignature: 's', outSignature: '' },
        { name: 'Connect', inSignature: '', outSignature: '' },
        { name: 'Disconnect', inSignature: '', outSignature: '' },
    ],
    signals: [
        { name: 'PropertyChanged', inSignature: 'sv', outSignature: '' },
    ],
};

const CMTechnologyInterface = {
    name: 'net.connman.Technology',
    methods: [
        { name: 'GetProperties', inSignature: '', outSignature: 'a{sv}' },
    ],
    signals: [
        { name: 'PropertyChanged', inSignature: 'sv', outSignature: '' },
    ],
};

const CMManagerProxy = DBus.makeProxyClass(CMManagerInterface);
const CMServiceProxy = DBus.makeProxyClass(CMServiceInterface);
const CMTechnologyProxy = DBus.makeProxyClass(CMTechnologyInterface);

function getIconForSignal(strength) {
    if (strength > 80)
        return 'network-wireless-signal-excellent';
    else if (strength > 60)
        return 'network-wireless-signal-good';
    else if (strength > 40)
        return 'network-wireless-signal-ok';
    else if (strength > 20)
        return 'network-wireless-signal-weak';
    else
        return 'network-wireless-signal-none';
}

function CMService(path, props) {
    this._init(path, props);
}

CMService.prototype = {
    _init: function(path, props) {
        this._object_path = path;
        this._proxy = new CMServiceProxy(DBus.system, 'net.connman', this._object_path);

        if (props)
            this._props = props;
        else {
            this._proxy.GetPropertiesRemote(Lang.bind(this, this._updateProperties));
        }

        this._proxy.connect('PropertyChanged', Lang.bind(this, this._propertyChanged));
    },

    _updateProperties: function(res, err) {
        if (err) {
            log('Unable to update properties for service "' + this._object_path);
            return;
        }

        this._props = res;
    },

    _propertyChanged: function(value, name) {
        log('Service property "' + name + '" changed to: ' + value);
        this._props[name] = value;
    },

    _getProperty: function(name) {
        return this._props[name];
    },

    setPassphrase: function(passphrase) {
        // this won't emit the PropertyChange signal so we need to change
        // the _props dict ourselves
        this._props['Passphrase'] = passphrase;
        this._proxt.SetPropertyRemote('Passphrase', this._props['Passphrase']);
    },

    get type() {
        return this._getProperty('Type');
    },

    get name() {
        return this._getProperty('Name');
    },

    get mode() {
        return this._getProperty('Mode');
    },

    get security() {
        return this._getProperty('Security');
    },

    get state() {
        return this._getProperty('State');
    },

    get strength() {
        return this._getProperty('Strength');
    },

    get isFavourite() {
        return this._getProperty('Favourite');
    },

    get isImmutable() {
        return this._getProperty('Immutable');
    },

    get autoConnect() {
        return this._getProperty('AutoConnect');
    },

    get isRoaming() {
        return this._getProperty('Roaming');
    },

    connect: function() {
        // set an unusually long timeout because the Connect method
        // will not return until success or error
        this._proxy.ConnectRemote({ timeout: 120000 }, Lang.bind(this, function(error) {
            log('Unable to connect: ' + error);
        }));
    },
};

function CMTechnologyTitleMenuItem(name, technology) {
    log('Attempting to use the abstract CMTechnologyTitleMenuItem');
}

CMTechnologyTitleMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(name, technology) {
	PopupMenu.PopupBaseMenuItem.prototype._init.call(this);

        this._name = name;
        this._technology = technology;

        this._manager = new CMManagerProxy(DBus.system, 'net.connman', '/');
        this._tech = new CMTechnologyProxy(DBus.system, 'net.connman', '/net/connman/technology/' + this._technology);
        this._tech.connect('PropertyChanged', Lang.bind(this, this._propertyChanged));

        this._description = new St.Label({ text: name,
                                           style_class: 'popup-subtitle-menu-item' });
        this.addActor(this._description);

        this._statusBin = new St.Bin({ x_align: St.Align.END });
        this.addActor(this._statusBin, { align: St.Align.END });

        this._switch = new PopupMenu.Switch(false);
        this._statusBin.child = this._switch.actor;

        this.section = new PopupMenu.PopupMenuSection();

        this.actor.reactive = true;
    },

    setDescription: function(description) {
        this._description.text = description;
    },

    setToggleState: function(is_online) {
        this._switch.setToggleState(is_online);
    },

    get state() {
        return this._switch.state;
    },

    clearServices: function() {
        this._services.removeAll();
    },

    updateServices: function(services) {
        this._services = services;

        log('Services: ' + this._services.length);

        if (this._services.length > 0) {
            this.actor.show();
            this.section.actor.show();
        }
    },

    activate: function(event) {
        if (this._switch.actor.mapped) {
            this._switch.toggle();
            this.emit('toggled', this._switch.state);
        }

        PopupMenu.PopupBaseMenuItem.prototype.activate.call(this, event);
    },

    _propertyChanged: function(value, name) {
        if (name == 'State') {
            if (value == 'enabled')
                this._switch.state = true;
            else
                this._switch.state = false;

            if (value == 'blocked')
                this.actor.reactive = false;
            else
                this.actor.reactive = true;
        }
    },

    enableTechnology: function() {
        if (this._switch.state)
            return;

        this._manager.EnableTechnologyRemote(this._technology, Lang.bind(this, function(error) {
            if (error) {
                log('Unable to enable ' + this._technology + ': ' + error);
                return;
            }

            this._switch.setToggleState(true);
        }));

        this.section.actor.visible = true;
    },

    disableTechnology: function() {
        if (!this._switch.state)
            return;

        this._manager.DisableTechnologyRemote(this._technology, Lang.bind(this, function(error) {
            if (error) {
                log('Unable to disable ' + this._technology + ': ' + error);
                return;
            }

            this._switch.setToggleState(false);
        }));

        this.section.actor.visible = false;
    },
};

function CMWiredTitleMenuItem() {
    return this._init(_('Wired'), 'ethernet');
}

CMWiredTitleMenuItem.prototype = {
    __proto__: CMTechnologyTitleMenuItem.prototype,
};

function CMWifiTitleMenuItem() {
    return this._init(_('Wifi'), 'wifi');
}

CMWifiTitleMenuItem.prototype = {
    __proto__: CMTechnologyTitleMenuItem.prototype,

    updateServices: function(services) {
        services.sort(function (one, two) {
            return two.strength - one.strength;
        });

        for (let i = 0; i < services.length; i++) {
            let service = services[i];
            let isOnline = service.state == 'online' ? true : false;

            let item = new CMWifiMenuItem(service.name);

            if (i >= N_VISIBLE_NETWORKS) {
                if (!this._overflowMenu) {
                    this._overflowMenu = new PopupMenu.PopupSubMenuMenuItem(_("More..."));
                    this.section.addMenuItem(this._overflowMenu);
                }

                this._overflowMenu.menu.addMenuItem(item);
            }
            else
                this.section.addMenuItem(item);

            item.setOnline(isOnline);
            item.updateStrength(service.strength);
            item.updateSecurity(service.security);

            item.connect('activate', Lang.bind(this, function() {
                service.connect();
            }));
        }

        CMTechnologyTitleMenuItem.prototype.updateServices.call(this, services);
    },

    activate: function(event) {
        CMTechnologyTitleMenuItem.prototype.activate.call(this, event);

        if (this.state)
            this.enableTechnology();
        else
            this.disableTechnology();
    },
};

function CMWifiMenuItem(name) {
    this._init(name);
}

CMWifiMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(name) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);

        this._name = new St.Label({ text: name });
        this.addActor(this._name);

        this._icons = new St.BoxLayout({ style_class: 'cw-menu-item-icons' });
        this.addActor(this._icons, { align: St.Align.END });

        this._security = new St.Icon({ style_class: 'popup-menu-icon' });
        this._icons.add_actor(this._security);

        this._strength = new St.Icon({ icon_name: 'network-wireless-signal-none',
                                       style_class: 'popup-menu-icon' });
        this._icons.add_actor(this._strength);
    },

    setOnline: function(isOnline) {
        this.setShowDot(isOnline);
    },

    updateStrength: function(strength) {
        this._strength.icon_name = getIconForSignal(strength);
    },

    updateSecurity: function(security) {
        let icon_name = 'network-wireless-encrypted';

        for (let i = 0; i < security.length; i++) {
            let sec = security[i];

            if (sec == 'none') {
                icon_name = 'network-wireless';
            }
        }

        this._security.icon_name = icon_name;
    },
};

function CMApplet() {
    this._init();
}

CMApplet.prototype = {
    __proto__: PanelMenu.SystemStatusButton.prototype,

    _init: function() {
        PanelMenu.SystemStatusButton.prototype._init.call(this, 'network-error');

        this._connman_proxy = new CMManagerProxy(DBus.system, 'net.connman', '/');

        this._services = [];

        this._sections = {};

        this._sections.wired = {
            section: new PopupMenu.PopupMenuSection(),
            item: new CMWiredTitleMenuItem(),
            services: [],
        };
        this._sections.wired.section.addMenuItem(this._sections.wired.item);
	    this._sections.wired.section.addMenuItem(this._sections.wired.item.section);
        this._sections.wired.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._sections.wired.section);

        this._sections.wifi = {
            section: new PopupMenu.PopupMenuSection(),
            item: new CMWifiTitleMenuItem(),
            services: [],
        };
        this._sections.wifi.section.addMenuItem(this._sections.wifi.item);
	    this._sections.wifi.section.addMenuItem(this._sections.wifi.item.section);
        this._sections.wifi.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._sections.wifi.section);

        this.menu.addAction(_('Network settings'), function(event) {
            let appSystem = Shell.AppSystem.get_default();
            let app = appSystem.get_app('carrick-standalone.desktop');
            app.activate(-1);
        });

        this._connman_proxy.connect('PropertyChanged', Lang.bind(this, this._propertyChanged));

        this._connman_proxy.GetPropertiesRemote(Lang.bind(this, this._getProperties));
        this._connman_proxy.GetStateRemote(Lang.bind(this, this._getState));
        this._connman_proxy.GetServicesRemote(Lang.bind(this, this._getServices));

        this.actor.visible = true;
    },

    _updateAvailableTechnologies: function(technologies) {
        this._sections.wifi.section.actor.hide();
        this._sections.wired.section.actor.hide();

        for (let i = 0; i < technologies.length; i++) {
            let tech = technologies[i];

            if (tech == 'wifi')
                this._sections.wifi.section.actor.show();

            if (tech == 'ethernet')
                this._sections.wired.section.actor.show();
        }
    },

    _updateEnabledTechnologies: function(technologies) {
        this._sections.wired.item.setToggleState(false);
        this._sections.wifi.item.setToggleState(false);

        for (let i = 0; i < technologies.length; i++) {
            let tech = technologies[i];

            if (tech == 'wifi') {
                this._sections.wifi.section.actor.show();
                this._sections.wifi.item.setToggleState(true);
            }

            if (tech == 'ethernet') {
                this._sections.wired.section.actor.show();
                this._sections.wired.item.setToggleState(true);
            }
        }
    },

    _updateServices: function(services) {
        this._sections.wired.section.removeAll();
        this._sections.wired.services = [];
        this._sections.wired.item = null;

        this._sections.wifi.section.removeAll();
        this._sections.wifi.services = [];
        this._sections.wifi.item = null;

        for (let i = 0; i < services.length; i++) {
            log('Service ' + i + ': ' + res[i]);
            let [objPath, objProps] = services[i];

            let service = new CMService(objPath, objProps);

            if (service.type == 'ethernet') {
                this._sections.wired.services.push(service);
            }

            if (service.type == 'wifi') {
                this._sections.wifi.services.push(service);
            }
        }

        this._sections.wired.item = new CMWiredTitleMenuItem();
        this._sections.wired.section.addMenuItem(this._sections.wired.item);
	    this._sections.wired.section.addMenuItem(this._sections.wired.item.section);
        this._sections.wired.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._sections.wired.item.updateServices(this._sections.wired.services);

        this._sections.wifi.item = new CMWifiTitleMenuItem();
        this._sections.wifi.section.addMenuItem(this._sections.wifi.item);
        this._sections.wifi.section.addMenuItem(this._sections.wifi.item.section);
        this._sections.wifi.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._sections.wifi.item.updateServices(this._sections.wifi.services);
    },

    _getProperties: function(res, err) {
        if (err) {
            log('Error:    ' + err);
            return;
        }

        if (res['AvailableTechnologies']) {
            let availableTech = res['AvailableTechnologies'];

            this._updateAvailableTechnologies(availableTech);
        }

        if (res['EnabledTechnologies']) {
            let enabledTech = res['EnabledTechnologies'];

            this._updateEnabledTechnologies(enabledTech);
        }

        if (res['State']) {
            this._state = res['State'];
        }

        this._updateIcon();
    },

    _getServices: function(res, err) {
        if (err)
            log('Error:    ' + err);

        if (res) {
            //this._sections.wired.section.clearServices();
            //this._sections.wifi.section.clearServices();

            for (let i = 0; i < res.length; i++) {
                log('Service ' + i + ': ' + res[i]);
                let [objPath, objProps] = res[i];

                let service = new CMService(objPath, objProps);

                if (service.type == 'ethernet') {
                    this._sections.wired.services.push(service);
                }

                if (service.type == 'wifi') {
                    this._sections.wifi.services.push(service);
                }
            }

            this._sections.wired.item.updateServices(this._sections.wired.services);
            this._sections.wifi.item.updateServices(this._sections.wifi.services);
        }

        this._updateIcon();
    },

    _getState: function(new_state, err) {
        if (err) {
            log('Error: ' + err);
            return;
        }

        this._state = new_state;
        this._updateIcon();
    },

    _clearServices: function() {
    },

    _propertyChanged: function(value, name) {
        log('Manager property "' + name + '" changed to: ' + value);

        if (name == 'AvailableTechnologies') {
            this._updateAvailableTechnologies(value);
            return;
        }

        if (name == 'EnabledTechnologies') {
            this._updateEnabledTechnologies(value);
            return;
        }

        if (name == 'Services') {
            this._updateServices(value);
            return;
        }

        if (name == 'State') {
            this._state = value;
        }

        this._updateIcon();
    },

    _updateIcon: function() {
        if (this._state == 'online') {
            if (this._sections.wired.services) {
                for (let i = 0; i < this._sections.wired.services.length; i++) {
                    let service = this._sections.wired.services[i];

                    // wired connections take over
                    if (service.state == 'online') {
                        this.setIcon('network-wired');
                        return;
                    }
                }

                for (let i = 0; i < this._sections.wifi.services.length; i++) {
                    let service = this._sections.wifi.services[i];

                    if (service.state == 'online') {
                        this.setIcon(getIconForSignal(service.strength));
                        return;
                    }
                }
            }
        }
        else {
            this.setIcon('network-offline');
        }
    },
};

function main() {
    Panel.STANDARD_TRAY_ICON_SHELL_IMPLEMENTATION['network'] = CMApplet;
}
