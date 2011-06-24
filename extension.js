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

// DBus interface
const CMManagerInterface = {
    name: 'net.connman.Manager',
    methods: [
        { name: 'GetState', inSignature: '', outSignature: 's' },
        { name: 'GetServices', inSignature: '', outSignature: 'a(oa{sv})' },
    ],
    signals: [
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

const CMManagerProxy = DBus.makeProxyClass(CMManagerInterface);
const CMServiceProxy = DBus.makeProxyClass(CMServiceInterface);

function CMService(path, props, item) {
    this._init(path, props, item);
}

CMService.prototype = {
    _init: function(path, props, item) {
        this._item = item;
        this._object_path = path;
        this._proxy = new CMServiceProxy(DBus.system, 'net.connman', this._object_path);

        if (props)
            this._props = props;
        else {
            this._proxy.GetPropertiesRemote(Lang.bind(this, this._updateProperties));
        }

        this._item.setDescription(this._getProperty('Name'));
        this._item.setToggleState(this._getProperty('State') == 'online' ? true : false);

        this._proxy.connect('PropertyChanged', Lang.bind(this, this._propertyChanged));
    },

    _updateProperties: function(res, err) {
        if (err) {
            log('Unable to update properties for service "' + this._object_path);
            return;
        }

        this._props = res;
    },

    _propertyChanged: function(name, value) {
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

    get Type() {
        return this._getProperty('Type');
    },

    get Mode() {
        return this._getProperty('Mode');
    },

    get Security() {
        return this._getProperty('Security');
    },

    get State() {
        return this._getProperty('State');
    },

    get Strength() {
        return this._getProperty('Strength');
    },

    get Favourite() {
        return this._getProperty('Favourite');
    },
};

function CMServiceMenuItem() {
    this._init();
}

CMServiceMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function() {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);

        this._description = new St.Label({ text: '',
                                           style_class: 'popup-subtitle-menu-item' });
        this.addActor(this._description);

        this._statusBin = new St.Bin({ x_align: St.Align.END });
        this.addActor(this._statusBin, { align: St.Align.END });

        this._switch = new PopupMenu.Switch(false);
        this._statusBin.child = this._switch.actor;

        this.actor.reactive = false;
    },

    setDescription: function(description) {
        this._description.text = description;
    },

    setToggleState: function(is_online) {
        this._switch.setToggleState(is_online);
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
            item: null,
            services: [],
            separator: new PopupMenu.PopupSeparatorMenuItem(),
        };
        this.menu.addMenuItem(this._sections.wired.section);
        this.menu.addMenuItem(this._sections.wired.separator);

        this._sections.wireless = {
            section: new PopupMenu.PopupMenuSection(),
            item: null,
            services: [],
            separator: new PopupMenu.PopupSeparatorMenuItem(),
        };
        this.menu.addMenuItem(this._sections.wireless.section);
        this.menu.addMenuItem(this._sections.wireless.separator);

        this.menu.addAction(_('Network settings'), function(event) {
            let appSystem = Shell.AppSystem.get_default();
            let app = appSystem.get_app('carrick-standalone.desktop');
            app.activate(-1);
        });

        this._connman_proxy.connect('StateChanged', Lang.bind(this, this._stateChanged));
        this._connman_proxy.GetStateRemote(Lang.bind(this, this._stateChanged));
        this._connman_proxy.GetServicesRemote(Lang.bind(this, this._getServices));

        this.actor.visible = true;
    },

    _getServices: function(res, err) {
        if (err)
            log('Error:    ' + err);

        if (res) {
            for (let i = 0; i < res.length; i++) {
                log('Service ' + i + ': ' + res[i]);
                let [objPath, objProps] = res[i];

                let item = new CMServiceMenuItem();
                let service = new CMService(objPath, objProps, item);

                this._services.push(service);

                if (service.Type == 'ethernet') {
                    this._sections.wired.services.push(service);
                    this._sections.wired.section.addMenuItem(item);
                }

                if (service.Type == 'wifi') {
                    this._sections.wireless.services.push(service);
                    this._sections.wireless.section.addMenuItem(item);
                }
            }
        }

        if (this._sections.wired.services.length == 0)
            this._sections.wired.separator.actor.visible = false;

        this._updateIcon();
    },

    _stateChanged: function(new_state) {
        log('State changed to: ' + new_state);
        this._state = new_state;
        this._updateIcon();
    },

    _updateIcon: function() {
        if (this._state == 'online') {
            if (this._services) {
                for (let i = 0; i < this._services.length; i++) {
                    let service = this._services[i];

                    if (service.Type == 'wifi') {
                        if (service.Security) {
                            this.setIcon('network-wireless-encrypted');
                        }
                        else {
                            this.setIcon('network-wireless');
                        }
                    }
                    else {
                        this.setIcon('network-wired');
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
