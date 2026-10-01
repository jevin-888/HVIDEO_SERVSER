"""Compare the real Rust models and player/management JSON writers, field for field."""
import argparse
from pathlib import Path
import re


def struct_fields(source, name, camel_case=False):
    match = re.search(r'\bstruct\s+' + name + r'\s*\{(.*?)^\}', source, re.S | re.M)
    if not match:
        raise AssertionError(f'Missing struct {name}')
    fields, renamed = set(), None
    for line in match[1].splitlines():
        rename = re.search(r'#\[serde\(rename\s*=\s*"([^"]+)"', line)
        if rename:
            renamed = rename[1]
        field = re.match(r'\s*(?:pub\s+)?(\w+)\s*:', line)
        if field:
            key = renamed or field[1]
            if camel_case and not renamed:
                key = re.sub(r'_([a-z])', lambda m: m[1].upper(), key)
            fields.add(key)
            renamed = None
    return fields


def written_fields(source, variable):
    return set(re.findall(r'\b' + variable + r'\["([^"\n]+)"\]\s*=', source))


def check(label, actual, expected):
    assert actual == expected, f'{label}: missing={expected - actual}, extra={actual - expected}'
    print(f'PASS: {label}, {len(actual)} fields match exactly')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--player-root', type=Path, required=True)
    args = parser.parse_args()
    server = Path(__file__).resolve().parents[1]
    read_server = lambda rel: (server / rel).read_text(encoding='utf-8-sig')
    read_player = lambda rel: (args.player_root / rel).read_text(encoding='utf-8-sig')
    models = read_server('src/models/terminal.rs')
    engine = read_player('src/core/Engine.cpp')
    admission = engine.split('OnlineVodAdmissionResult requestOnlineVodAdmission(', 1)[1].split('\nvoid reportDeviceToLicenseServer(', 1)[0]
    check('HTTP admission', written_fields(admission, 'request'), struct_fields(models, 'TerminalAdmissionRequest', True))
    discovery = read_player('src/network/DeviceDiscoveryService.cpp')
    builder = discovery.split('Json::Value DeviceDiscoveryService::buildDiscoveryJson(', 1)[1].split('bool DeviceDiscoveryService::start(', 1)[0]
    receiver = read_server('src/discover/mod.rs')
    check('UDP discovery response', written_fields(builder, 'root') | {'challenge'}, struct_fields(receiver, 'DiscoverResponse'))
    check('Discovery ports', written_fields(builder, 'ports'), struct_fields(receiver, 'DiscoverPorts'))
    offer_writer = receiver.split('fn server_online_offer(', 1)[1].split('#[cfg(test)]', 1)[0]
    offer_reader = read_player('include/core/OnlineVodDiscovery.h').split('inline bool requestsOnlineVodSwitch', 1)[0]
    check('Server online VOD offer', set(re.findall(r'"(\w+)"\s*:', offer_writer)),
          set(re.findall(r'value\["(\w+)"\]', offer_reader)))
    assert 'switchToOnlineVod' in struct_fields(models, 'TerminalAdmission', True)
    assert 'admission["switchToOnlineVod"].isBool()' in read_player('include/core/OnlineVodDiscovery.h')
    system = read_player('src/utils/SystemUtils.cpp')
    network = system.split('Json::Value SystemUtils::getNetworkReport(', 1)[1].split('std::string SystemUtils::getDeviceName(', 1)[0]
    check('Network report', written_fields(network, 'report'), struct_fields(models, 'TerminalNetworkReport', True))
    admin = read_server('static/admin/admin.js')
    manual = re.search(r'apiService\.registerTerminal\(\{([^}]+)\}', admin)
    assert manual, 'Missing manual registration writer'
    check('Manual registration', set(re.findall(r'\b(\w+)\s*:', manual[1])), struct_fields(models, 'RegisterPlayerTerminalRequest'))
    print('Terminal registration protocols match on both sides.')


if __name__ == '__main__':
    main()
