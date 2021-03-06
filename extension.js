// global imports
const Clutter = imports.gi.Clutter;
const DBus = imports.dbus;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

// shell imports
const ModalDialog = imports.ui.modalDialog;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

// localization
const Gettext = imports.gettext.domain('gnome-shell');
const _ = Gettext.gettext;

const N_VISIBLE_NETWORKS = 5;

// DBus interfaces
const DBusInterface = {
    name: 'org.freedesktop.DBus',
    signals: [
        { name: 'NameOwnerChanged', inSignature: 'sss', outSignature: '' },
    ],
};

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
        // set an unusually long timeout because the Connect method
        // will not return until success or error
        { name: 'Connect', inSignature: '', outSignature: '', timeout: 120000 },
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

const DBusProxy = DBus.makeProxyClass(DBusInterface);
const CMManagerProxy = DBus.makeProxyClass(CMManagerInterface);
const CMServiceProxy = DBus.makeProxyClass(CMServiceInterface);
const CMTechnologyProxy = DBus.makeProxyClass(CMTechnologyInterface);

// common code for selecting the icon depending
// on the signal strength
function getIconForSignal(strength) {
    if (strength > 80)
        return 'network-wireless-signal-excellent';
    else if (strength > 55)
        return 'network-wireless-signal-good';
    else if (strength > 30)
        return 'network-wireless-signal-ok';
    else if (strength > 5)
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
            //log('Requesting properties for service: ' + this._object_path);
            this._props = { };
            this._proxy.GetPropertiesRemote(Lang.bind(this, this._updateProperties));
        }

        this._proxy.connect('PropertyChanged', Lang.bind(this, this._propertyChanged));
    },

    _updateProperties: function(res, err) {
        if (err) {
            log('Unable to update properties for service "' + this._object_path + '": ' + err);
            return;
        }

        //log('Updating properties for service: ' + this._object_path);
        this._props = res;
        this.emit('changed');
    },

    _propertyChanged: function(emitter, name, value) {
        //log('Service property "' + name + '" changed to: ' + value);
        this._props[name] = value;
        this.emit('changed');
    },

    _getProperty: function(name) {
        if (!this._props)
            return null;

        return this._props[name];
    },

    setPassphrase: function(passphrase) {
        if (!this._props)
            this._props = { };

        // this won't emit the PropertyChange signal so we need to change
        // the _props dict ourselves
        this._props['Passphrase'] = passphrase;
        this._proxy.SetPropertyRemote('Passphrase', this._props['Passphrase'],
                                      Lang.bind(this, function(err) {
            if (err) {
                log('Unable to set the passphrase for connection "' + this.name + '"');
            }
        }));
    },

    unsetPassphrase: function() {
        this._props['Passphrase'] = null;
        this._proxy.ClearPropertyRemote('Passphrase', Lang.bind(this, function(err) {
            if (err) {
                log('Unable to unset the passphrase for connection "' + this.name + '"');
            }
        }));
    },

    get path() {
        return this._object_path;
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

    get passphraseRequired() {
        return this._getProperty('PassphraseRequired');
    },

    get passphrase() {
        return this._getProperty('Passphrase');
    },

    _onDialogDone: function(dialog, keepVisible, wasDismissed) {
        if (this._dialogIsCompleting)
            return;

        this._dialogIsCompleting = true;

        if (keepVisible) {
            Mainloop.timeout_add(2000, Lang.bind(this, function() {
                this._connectionDialog.close();
                this._connectionDialog = null;
            }));
        }
        else {
            this._connectionDialog.close();
            this._connectionDialog = null;
        }
    },

    connectService: function() {
        if (!this.isImmutable &&
             this.passphraseRequired &&
             this.passphrase == null) {
            this._connectionDialog = new CMAuthenticationDialog(this);
            this._connectionDialog.connect('done', Lang.bind(this, this._onDialogDone));

            this._dialogIsCompleting = false;

            this._connectionDialog.open();

            return;
        }

        this._proxy.ConnectRemote(Lang.bind(this, function(error) {
            if (error) {
                log('Unable to connect: ' + error);
                this.emit('connection-failed', error);
            }
            else
                this.emit('connected');
        }));
    },

    disconnectService: function() {
        this._proxy.DisconnectRemote({ timeout: 120000 }, Lang.bind(this, function(error) {
            if (error)
                log('Unable to disconnect: ' + error);
            else
                this.emit('disconnected');
        }));
    },
};
Signals.addSignalMethods(CMService.prototype);

function CMAuthenticationDialog(service) {
    this._init(service);
}

CMAuthenticationDialog.prototype = {
    __proto__: ModalDialog.ModalDialog.prototype,

    _init: function(service) {
        ModalDialog.ModalDialog.prototype._init.call(this);

        this._service = service;

        this._service.connect('connected', Lang.bind(this, function() {
            this._emitDone(false, false);
        }));
        this._service.connect('connection-failed', Lang.bind(this, function(error) {
            // unset the stored password
            this._service.unsetPassphrase();

            this._passwordBox.hide();
            this._errorMessageLabel.text = error;
            this._errorMessageLabel.show();
            this._emitDone(true, false);
        }));

        let message = _("The wifi network '" + service.name + "' requires a password to access it");

        let mainContentBox = new St.BoxLayout({ style_class: 'cm-dialog-main-layout',
                                                vertical: false });
        this.contentLayout.add(mainContentBox, { x_fill: true, y_fill: true });

        let icon = new St.Icon({ icon_name: 'dialog-password-symbolic' });
        mainContentBox.add(icon, { x_fill: true,
                                   y_fill: false,
                                   x_align: St.Align.END,
                                   y_align: St.Align.START });

        let messageBox = new St.BoxLayout({ style_class: 'cm-dialog-message-layout',
                                            vertical: true });
        mainContentBox.add(messageBox, { y_align: St.Align.START });

        this._subjectLabel = new St.Label({ style_class: 'cm-dialog-headline',
                                            text: _("Authentication Required") });
        messageBox.add(this._subjectLabel, { y_fill: false, y_align: St.Align.START });

        this._descriptionLabel = new St.Label({ style_class: 'cm-dialog-description',
                                                text: message });
        this._descriptionLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._descriptionLabel.clutter_text.line_wrap = true;
        messageBox.add(this._descriptionLabel, { y_fill: true, y_align: St.Align.START });

        this._passwordBox = new St.BoxLayout({ vertical: false });
        messageBox.add(this._passwordBox);

        this._passwordLabel = new St.Label({ style_class: 'cm-dialog-password-label' });
        this._passwordBox.add(this._passwordLabel);
        this._passwordEntry = new St.Entry({ style_class: 'cm-dialog-password-entry',
                                             text: '',
                                             can_focus: true });
        this._passwordEntry.clutter_text.connect('activate', Lang.bind(this, this._onEntryActivate));
        this._passwordEntry.clutter_text.set_password_char('\u25cf'); // ● U+25CF BLACK CIRCLE
        this._passwordBox.add(this._passwordEntry, { expand: true });

        this._errorMessageLabel = new St.Label({ style_class: 'cm-dialog-error-label' });
        this._errorMessageLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._errorMessageLabel.clutter_text.line_wrap = true;
        messageBox.add(this._errorMessageLabel);
        this._errorMessageLabel.hide();

        this.setButtons([
            {
                label: _("Cancel"),
                action: Lang.bind(this, this.cancel),
                key: Clutter.Escape,
            },
            {
                label: _("Connect"),
                action: Lang.bind(this, this._onConnectButtonPressed),
            },
        ]);

        this._doneEmitted = false;

        this.connect('opened', Lang.bind(this, function() {
            this._passwordEntry.grab_key_focus();
        }));
    },

    cancel: function() {
        this._wasDismissed = true;
        this.close(global.get_current_time());
        this._emitDone(false, true);
    },

    _emitDone: function(keepVisible, wasDismissed) {
        if (!this._doneEmitted) {
            this._doneEmitted = true;
            this.emit('done', keepVisible, wasDismissed);
        }
    },

    _onEntryActivate: function() {
        let passphrase = this._passwordEntry.get_text();

        // set the passphrase
        this._service.setPassphrase(passphrase);

        // connect
        this._service.connectService();
    },

    _onConnectButtonPressed: function() {
        this._onEntryActivate();
    },

    
};
Signals.addSignalMethods(CMAuthenticationDialog.prototype);

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

    setToggleState: function(is_enabled) {
        this._switch.setToggleState(is_enabled);
    },

    addServiceItem: function(item, overflow) {
        if (overflow) {
            //log('Adding overflow sub-menu for ' + this._description.text);
            if (!this._overflowMenu) {
                this._overflowMenu = new PopupMenu.PopupSubMenuMenuItem(_("More..."));
                this.section.addMenuItem(this._overflowMenu);
            }
            this._overflowMenu.menu.addMenuItem(item);
        }
        else {
            this.section.addMenuItem(item);
        }
    },

    get state() {
        return this._switch.state;
    },

    _propertyChanged: function(emitter, name, value) {
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
        this._manager.EnableTechnologyRemote(this._technology, Lang.bind(this, function(error) {
            if (error) {
                log('Unable to enable ' + this._technology + ': ' + error);
                return;
            }
        }));
    },

    disableTechnology: function() {
        this._manager.DisableTechnologyRemote(this._technology, Lang.bind(this, function(error) {
            if (error) {
                log('Unable to disable ' + this._technology + ': ' + error);
                return;
            }
        }));
    },

    activate: function(event) {
        if (this._switch.actor.mapped) {
            this._switch.toggle();
            this.emit('toggled', this._switch.state);
        }

        if (this.state)
            this.enableTechnology();
        else
            this.disableTechnology();

        PopupMenu.PopupBaseMenuItem.prototype.activate.call(this, event);
    },
};

function CMServiceMenuItem(service) {
    this._init(service);
}

CMServiceMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(service) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);

        this.service = service;
        this.serviceChangedId = this.service.connect('changed', Lang.bind(this, this._serviceChanged));

        this._name = new St.Label({ text: service.name });
        this.addActor(this._name);

        this._icons = new St.BoxLayout({ style_class: 'cw-menu-item-icons' });
        this.addActor(this._icons, { align: St.Align.END });

        this._security = new St.Icon({ style_class: 'popup-menu-icon' });
        this._icons.add_actor(this._security);

        this._strength = new St.Icon({ icon_name: 'network-wireless-signal-none',
                                       style_class: 'popup-menu-icon' });
        this._icons.add_actor(this._strength);

        this.setDescription(this.service.name);
        this.setOnline(this.service.state == 'online');
        this.updateStrength(this.service.strength);
        this.updateSecurity(this.service.security);

        this._icons.visible = this.service.type == 'wifi' ? true : false;
    },

    setDescription: function(description) {
        this._name.text = description;
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
                icon_name = '';
            }
        }

        this._security.icon_name = icon_name;
    },

    _serviceChanged: function() {
        if (this.service.type == 'wifi')
            this._icons.visible = true;
        else
            this._icons.visible = false;

        this.setOnline(this.service.state == 'online' ? true : false);
        this.setDescription(this.service.name);
        this.updateStrength(this.service.strength);
        this.updateSecurity(this.service.security);
    },

    activate: function(event) {
        this.service.connectService();

        PopupMenu.PopupBaseMenuItem.prototype.activate.call(this, event);
    },

    destroy: function() {
        if (this.serviceChangedId) {
            this.service.disconnect(this.serviceChangedId);
            this.serviceChangedId = 0;
        }

        PopupMenu.PopupBaseMenuItem.prototype.destroy.call(this);
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

};

function CMApplet() {
    this._init();
}

CMApplet.prototype = {
    __proto__: PanelMenu.SystemStatusButton.prototype,

    _init: function() {
        PanelMenu.SystemStatusButton.prototype._init.call(this, 'network-error');

        this._bus_proxy = new DBusProxy(DBus.system, 'org.freedesktop.DBus', '/org/freedesktop/DBus');
        this._bus_proxy.connect('NameOwnerChanged', Lang.bind(this, this._nameOwnerChanged));

        this._connman_proxy = new CMManagerProxy(DBus.system, 'net.connman', '/');

        this._services = [ ];

        // the various sections of the menu
        this._sections = { };

        // Wired
        this._sections.wired = {
            section: new PopupMenu.PopupMenuSection(),
            item: new CMWiredTitleMenuItem(),
            services: [],
            available: false,
            enabled: false,
        };
        this._sections.wired.section.addMenuItem(this._sections.wired.item);
	    this._sections.wired.section.addMenuItem(this._sections.wired.item.section);
        this._sections.wired.section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._sections.wired.section);

        // Wifi
        this._sections.wifi = {
            section: new PopupMenu.PopupMenuSection(),
            item: new CMWifiTitleMenuItem(),
            services: [],
            available: false,
            enabled: false,
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

    _setHasDaemon: function(hasDaemon) {
        if (this._hasDaemon == hasDaemon)
            return;

        this._hasDaemon = hasDaemon;

        this._sections.wired.section.actor.visible = this._hasDaemon;
        this._sections.wifi.section.actor.visible = this._hasDaemon;
        this._updateIcon();
    },

    _nameOwnerChanged: function(emitter, name, old_owner, new_owner) {
        if (name != 'net.connman')
            return;

        if (!new_owner) {
            this._setHasDaemon(false);
        }
        else {
            this._setHasDaemon(true);
        }
    },

    _updateAvailableTechnologies: function(technologies) {
        this._sections.wired.available = false;
        this._sections.wifi.available = false;

        for (let i = 0; i < technologies.length; i++) {
            let tech = technologies[i];

            if (tech == 'ethernet') {
                this._sections.wired.available = true;
            }

            if (tech == 'wifi') {
                this._sections.wifi.available = true;
            }
        }

        this._sections.wired.section.actor.visible = this._sections.wired.available;
        this._sections.wifi.section.actor.visible = this._sections.wifi.available;
    },

    _updateEnabledTechnologies: function(technologies) {
        this._sections.wired.enabled = false;
        this._sections.wifi.enabled = false;

        for (let i = 0; i < technologies.length; i++) {
            let tech = technologies[i];

            if (tech == 'ethernet') {
                this._sections.wired.enabled = true;
            }

            if (tech == 'wifi') {
                this._sections.wifi.enabled = true;
            }
        }

        this._sections.wired.item.setToggleState(this._sections.wired.enabled);
        this._sections.wifi.item.setToggleState(this._sections.wifi.enabled);
    },

    _getProperties: function(res, err) {
        if (err) {
            log('Unable to get net.connman.Manager properties: ' + err);
            this._setHasDaemon(false);
            return;
        }

        this._setHasDaemon(true);

        if (res['AvailableTechnologies']) {
            let availableTech = res['AvailableTechnologies'];

            this._updateAvailableTechnologies(availableTech);
        }

        if (res['EnabledTechnologies']) {
            let enabledTech = res['EnabledTechnologies'];

            this._updateEnabledTechnologies(enabledTech);
        }

        this._updateIcon();
    },

    _getServices: function(res, err) {
        this._sections.wired.item.section.removeAll();
        this._sections.wifi.item.section.removeAll();

        // disconnect all signal handlers
        for (let i = 0; i < this._services.length; i++) {
            let obj = this._services[i];

            obj.service.disconnect(obj.changedId);
        }

        this._sections.wired.services = [ ];
        this._sections.wifi.services = [ ];
        this._services = [ ];

        if (err) {
            this._setHasDaemon(false);
            log('Unable to get services: ' + err);
            return;
        }

        if (res) {
            this._setHasDaemon(true);

            for (let i = 0; i < res.length; i++) {
                let [objPath, objProps] = res[i];
                let obj = {
                    path: objPath,
                    service: new CMService(objPath, objProps),
                    item: null,
                };

                obj.item = new CMServiceMenuItem(obj.service);

                obj.changedId = obj.service.connect('changed', Lang.bind(this, function() {
                    this._updateIcon();
                }));

                if (obj.service.type == 'ethernet') {
                    //log('Adding "' + obj.service.name + '" to the wired services');
                    this._sections.wired.services.push(obj);
                }

                if (obj.service.type == 'wifi') {
                    //log('Adding "' + obj.service.name + '" to the wifi services');
                    this._sections.wifi.services.push(obj);
                }

                this._services.push(obj);
            }
        }

        for (let i = 0; i < this._sections.wired.services.length; i++) {
            let obj = this._sections.wired.services[i];

            this._sections.wired.item.addServiceItem(obj.item);
        }

        // hide the wired connections if we only have 1
        if (this._sections.wired.services.length > 1)
            this._sections.wired.item.section.actor.show();
        else
            this._sections.wired.item.section.actor.hide();

        this._sections.wifi.services.sort(function(one, two) {
            // online services take the precedence
            if (one.service.state == 'online')
                return -1;

            if (two.service.state == 'online')
                return 1;

            return two.service.strength - one.service.strength;
        });

        for (let i = 0; i < this._sections.wifi.services.length; i++) {
            let obj = this._sections.wifi.services[i];

            if (i >= N_VISIBLE_NETWORKS)
                this._sections.wifi.item.addServiceItem(obj.item, true);
            else
                this._sections.wifi.item.addServiceItem(obj.item, false);
        }

        this._updateIcon();
    },

    _getState: function(new_state, err) {
        if (err) {
            log('Unable to get net.connman.Manager state: ' + err);
            this._setHasDaemon(false);
            return;
        }

        this._state = new_state;
        this._setHasDaemon(true); // this will call updateIcon()
    },

    _propertyChanged: function(emitter, name, value) {
        //log('Manager property "' + name + '" changed to: ' + value);

        if (name == 'AvailableTechnologies') {
            this._updateAvailableTechnologies(value);
        }

        if (name == 'EnabledTechnologies') {
            this._updateEnabledTechnologies(value);
        }

        if (name == 'Services') {
            // XXX - this hateful piece of code is here because getting the
            // Services property only gives you an array of object paths,
            // so we need to re-request the list of services
            this._connman_proxy.GetServicesRemote(Lang.bind(this, this._getServices));
        }

        if (name == 'State') {
            log('New state (PropertyChanged): ' + value);
            this._state = value;
        }

        this._updateIcon();
    },

    _updateIcon: function() {
        if (!this._hasDaemon) {
            this.setIcon('network-offline');
            return;
        }

        // online wired connections always win
        for (let i = 0; i < this._sections.wired.services.length; i++) {
            let obj = this._sections.wired.services[i];

            if (obj.service.state == 'ready' ||
                obj.service.state == 'online') {
                this.setIcon('network-wired');
                return;
            }
        }

        for (let i = 0; i < this._sections.wifi.services.length; i++) {
            let obj = this._sections.wifi.services[i];

            if (obj.service.state == 'idle')
                continue;

            // the first online wifi wins
            if (obj.service.state == 'online') {
                this.setIcon(getIconForSignal(obj.service.strength));
                return;
            }
            else if (obj.service.state == 'association' ||
                     obj.service.state == 'configuration' ||
                     obj.service.state == 'ready') {
                this.setIcon('network-wireless-acquiring');
                return;
            }
        }

        // if we got here then we don't have any online connection
        this.setIcon('network-offline');
    },
};

function main(metadata) {
    log('Starting ConnMan extension - version: ' + metadata.version);
    Panel.STANDARD_TRAY_ICON_SHELL_IMPLEMENTATION['network'] = CMApplet;
}
