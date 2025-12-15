Homebridge ConnectLife Aircon
============================

Control your ConnectLife air conditioners from Apple HomeKit using Homebridge.

This plugin connects to your ConnectLife account and exposes your air
conditioners as Heater / Cooler accessories in the Apple Home app.


What this plugin does
---------------------

For each configured air conditioner, HomeKit will show:

- Power on / off
- Auto / Cool / Heat modes
- Target temperature control
- Current room temperature
- Fan speed control
- Swing mode on / off

Everything is controlled from the Home app or via Siri.


Requirements
------------

- A valid ConnectLife account
- One or more air conditioners visible in the ConnectLife mobile app
- Homebridge version 1.6 or newer
- Node.js version 18 or newer


Installation
------------

From the Homebridge UI (recommended):

1. Open the Homebridge web interface
2. Go to "Plugins"
3. Search for "Homebridge ConnectLife Aircon"
4. Install the plugin
5. Restart Homebridge


Configuration
-------------

The user must configure the following fields:

- Email
- Password
- Appliances (by exact name)


IMPORTANT: Appliance name
-------------------------

The appliance name MUST exactly match the name shown in the ConnectLife app.

- It is case-sensitive
- Spaces must match exactly

Examples:
- "Living Room AC"  -> correct
- "living room ac"  -> wrong


Example configuration
---------------------

{
  "platform": "ConnectLifeAircon",
  "email": "you@example.com",
  "password": "your_connectlife_password",
  "appliances": [
    {
      "name": "Living Room AC"
    },
    {
      "name": "Bedroom AC"
    }
  ]
}


After setup
-----------

- Restart Homebridge
- Open the Apple Home app
- Your air conditioners will appear automatically
- Each AC is shown as a single Heater / Cooler accessory


Common issues
-------------

AC does not appear:
- Check the appliance name matches exactly
- Make sure the device is online in the ConnectLife app
- Restart Homebridge and check logs

Commands do not work:
- Verify email and password
- Make sure your ConnectLife account is working in the official app
- Check Homebridge logs for errors


Notes
-----

- This plugin uses the ConnectLife cloud API (no local control)
- Auto mode behavior depends on the AC model and firmware
- Fan speed is mapped approximately to HomeKit percentages


Disclaimer
----------

This project is not affiliated with or endorsed by ConnectLife.
All trademarks belong to their respective owners.


License
-------

MIT
