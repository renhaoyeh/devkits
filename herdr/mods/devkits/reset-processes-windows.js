// Windows Script Host: report only PIDs of this installation's finite Node helpers.
// Never emit process command lines, which can contain private data.
function resetWriterPids(rows, root, ownPid) {
  var prefix = String(root).replace(/\\/g, '/').toLowerCase() + '/mods/devkits';
  var result = [], iterator = new Enumerator(rows);
  for (; !iterator.atEnd(); iterator.moveNext()) {
    var row = iterator.item(), pid = Number(row.ProcessId);
    if (pid !== ownPid && String(row.Name).toLowerCase() === 'node.exe' &&
        String(row.CommandLine || '').replace(/\\/g, '/').toLowerCase().indexOf(prefix) >= 0) result.push(pid);
  }
  return result;
}
if (typeof WScript !== 'undefined') {
  try {
    var root = String(WScript.Arguments.Item(0)), ownPid = Number(WScript.Arguments.Item(1));
    if (!root || !(ownPid > 0)) throw new Error('Invalid process query');
    var connection = new ActiveXObject('WbemScripting.SWbemLocator').ConnectServer('.', 'root\\cimv2');
    var rows = connection.ExecQuery("SELECT ProcessId, Name, CommandLine FROM Win32_Process WHERE Name = 'node.exe'");
    WScript.Echo('[' + resetWriterPids(rows, root, ownPid).join(',') + ']');
  } catch (error) { WScript.Echo('[]'); WScript.Quit(1); }
}
